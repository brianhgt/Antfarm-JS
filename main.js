var jq = jQuery.noConflict();

// Constants
const TILE = {
  EMPTY: 'EMPTY',
  DIRT: 'DIRT',
  ROCK: 'ROCK',
  WATER: 'WATER',
  NEST: 'NEST',
  FOOD: 'FOOD',
  EGG: 'EGG'
};
const ANT_TYPE = { QUEEN: 0, WORKER: 1, SOLDIER: 2, FEMALE: 3, MALE: 4 };
const TILE_OPEN_SPACE = 1;
const SPIDER_CAN_GO_BELOW = false;
const WANDER_DIST = 6;
const EGG_HATCH_TIME = 1000 / 60; // ~16.7 seconds
const SPIDER_COOLDOWN = 5;       // seconds between bites
const FOOD_SPAWN_INTERVAL = 20;  // seconds between food spawns
const PLAYER_SPEED = 6;   // roughly 0.1 per frame @60fps
const ANT_SPEED = 2.4; // roughly 0.04 per frame @60fps
const SPIDER_SPEED = 1.2; // roughly 0.02 per frame @60fps
const PATH_TOLERANCE = 0.08; // 8%: choose from near-best A* frontier nodes for route variety
const WORLD_X_MAX = 80; // Each nest is 80 blocks wide
const WORLD_Y_MAX = 160;
const WORLD_Z_MAX = 40;
const FOOD_GROUP_SIZE = 5;
const DEFAULT_NEST_Y = 40;
const OVERWORLD_Y_RATIO = 20; //Number of tiles in the overworld to the next nest section


const DEFAULT_TILE_HP = {
  EMPTY: 0,
  DIRT: 30,
  ROCK: 80,
  WATER: 10,
  NEST: 10,
  FOOD: 10,
  EGG: 10
};

// Shared tile/world helpers live in `util.js` under `Util` and global aliases.

// timer for spawning food
let foodSpawnInterval = FOOD_SPAWN_INTERVAL;
let foodSpawnTimer = foodSpawnInterval;

jq(function(){


let maxEntities = 2000;
let numSpiders = 1;
let foodSpawnAmount = 5;


// 3D world map stored as viewMap[x][y][z] so that storage matches
// our human-readable coordinate order (x,y,z).  Every function that
// takes a location expects the components in that order; the loops
// below build the nested arrays accordingly.
let viewMap = [];
for(let x = 0; x < WORLD_X_MAX; x++){
  let plane = [];
  for(let y = 0; y < WORLD_Y_MAX; y++){
    let column = [];
    for(let z = 0; z < WORLD_Z_MAX; z++){
      // top portion of each nest/overworld plane is empty space
      column.push(createTile(z < TILE_OPEN_SPACE ? TILE.EMPTY : TILE.DIRT));
    }
    plane.push(column);
  }
  viewMap.push(plane);
}  // previously used 2D `map`, now replaced by this 3D structure

// expose aliases expected by util.js
window.world = viewMap;
window.overworld = viewMap;


// no longer maintain separate nestMaps array; everything lives in the single 3D `viewMap` above.

// initial food on surface
let foods = new Map();
for(let i=0;i<foodSpawnAmount;i++){
  let fx=Math.floor(Math.random()*WORLD_X_MAX);
  let fy= Math.floor(Math.random()*WORLD_Y_MAX); //TODO
  let fz= 0; //surface level
  foods.set(get3dHash(fx, fy, fz), {x:fx,y:fy,z:fz,carry:false});
}

let spiderScore=0;
const colonies=[
  {name:"A", color:"black", nest:{}, eggs:new Map(), workers:[], soldiers:[], player:{}, score:0, playerTarget:null},
  {name:"B", color:"red", nest:{}, eggs:new Map(), workers:[], soldiers:[], player:{}, score:0, playerTarget:null}
];

// Initialize spiders dynamically
let spiders = [];
for(let i = 0; i < numSpiders; i++) {
  spiders.push({
    x: Math.floor(Math.random() * WORLD_X_MAX),
    y: Math.floor(Math.random() * WORLD_Y_MAX),
    z: 0, //spawn on surface only
    target: null,
    path: null,
    pathIndex: 0,
    timer: EGG_HATCH_TIME,
    cooldownTimer: SPIDER_COOLDOWN
  });
}
const skulls=[];

//Initialize nests
colonies.forEach((col, colIdx)=>{
  let nx=0, ny=0, nz=0;
  //let nestMap = nestMaps[colIdx];
  //do{
    //subtract 2 for egg spawn distance
    nx = 4 + Math.floor(Math.random()*(WORLD_X_MAX - 4));
    ny = DEFAULT_NEST_Y; //TODO nests should start at opposite sides of the volume
    nz = 2 + 1 + Math.min(Math.floor(Math.random()*(WORLD_Z_MAX - 4)), NEST_MAX_DEPTH);

    // directly modify the 3D storage (now x,y,z order)
    setBlock(nx, ny, nz, TILE.NEST);
    setBlock(nx, ny, nz + 1, TILE.NEST);

    //Clear 1 block around nest
    for(let x = nx - 1; x <= nx + 1; x++) {
        for(let z = nz - 1; z <= nz + 2; z++) {
          if(x >= 0 && x < WORLD_X_MAX && z >= 0 && z < WORLD_Z_MAX) {
            if(isTileType(getBlockAt(x, ny, z), TILE.DIRT)) {
              setBlock(x, ny, z, TILE.EMPTY);
            }
          }
        }
    }

    //Create an empty path that goes down and to the left/right, then up to the surface.
    for(let i = 1; i <= 3; i++) {
      setBlock(nx - i, ny, nz + 1, TILE.EMPTY); // horizontal tunnel
      setBlock(nx - i, ny, nz + 2, TILE.EMPTY); // horizontal tunnel
    }
    
    let xShift = 0;
      for(let z = nz + 2; z > 0; z--) {
         setBlock(nx - 3 + xShift, ny, z, TILE.EMPTY); // vertical tunnel
         if(Math.random() < 0.1) {
          xShift += Math.ceil(Math.random() * 3 - 2); // randomly shift left, right, or stay straight 
          setBlock(nx - 3 + xShift, ny, z, TILE.EMPTY);
         }
      }

    

  // }while(nestMap[ny] && nestMap[ny][nx] && nestMap[ny][nx]!=TILE.DIRT);
  // if(nestMap[ny] && nestMap[ny][nx] !== undefined) {
  //   nestMap[ny][nx]=TILE.NEST;
  //   nestMap[ny + 1][nx]=TILE.NEST;
  // }
  col.nest={x:nx, y:ny, z:nz, sX:nx, sY:ny, sZ:nz +1}; // soldier spawn adjacent to worker spawn
  
  //place player
  col.player={x:nx+0.5, y:ny+0.5, z:nz+0.5, carrying:null};
  
  // spawn egg
  let ex = nx+1, ey = ny, ez = nz; //spawn egg 1 block to the right
  // if(getBlockAt(ex, ey, ez) == TILE.DIRT) {
    //TODO do a protected write to the block here
    setBlock(ex, ey, ez, TILE.EMPTY);
    col.eggs.set(get3dHash(ex, ey, ez), {x:ex, y:ey, z:ez, type:ANT_TYPE.WORKER, timer:EGG_HATCH_TIME, carry:false});
  // }
});

// click-to-move
inputCanvas.addEventListener('click', e=>{
  if(suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  const rect=inputCanvas.getBoundingClientRect();
  let mx=0;
  let my=0;
  let mz=0;
  
  // Apply camera offset in nest view
  if(primaryViewport.view === 'nest') {
    const blockSize = getScreenBlockSize();
    mx=(e.clientX-rect.left)/blockSize;
    my=Math.floor(colonies[0].player.y);
    mz=(e.clientY-rect.top)/blockSize;

    mx += primaryViewport.cameraX;
    my += 0;
    mz += primaryViewport.cameraY;
    // Check bounds against nest size
    if(mx >= 0 && mx < WORLD_X_MAX
       && my >= 0 && my < WORLD_Y_MAX
       && mz >= 0 && mz < WORLD_Z_MAX) {
      colonies[0].playerTarget={x:mx, y:my, z:mz};
    }
  } else {
    //Apply camera offset in overworld view
    // Check bounds
    // Now camera is landscape, so Y is horizontal and X is vertical
    
    const blockSize = getScreenBlockSize();
    mx=(e.clientY-rect.top)/blockSize;
    my=(e.clientX-rect.left)/blockSize;
    mz= 0; //surface level only for overworld clicks for now

    mx += primaryViewport.cameraY;
    my += primaryViewport.cameraX;
    mz += 0;
    if(mx >= 0 && mx < WORLD_X_MAX
        && my >= 0 && my < WORLD_Y_MAX
        && mz >= 0 && mz < WORLD_Z_MAX) {
      colonies[0].playerTarget={x:mx, y:my, z:mz};
    }
  }
});




// `delta` is the elapsed time in seconds since the last frame. all logic that
// depends on time (movement, timers, etc.) uses this value so the simulation
// runs at a defined speed regardless of the actual framerate.
function update(delta){
  foodSpawnTimer -= delta;
  if(foodSpawnTimer<=0){
    foodSpawnTimer=foodSpawnInterval;
    for(let i=0;i<foodSpawnAmount;i++){
      let fx = Math.floor(Math.random() * WORLD_X_MAX);
      //let fy = Math.floor(Math.random() * WORLD_Y_MAX);
      //TODO spawn along y=0 line to make it more likely ants will find the food, for now
      let fy = Math.floor(Math.random() * WORLD_Y_MAX); //TODO spawn along y=0 line to make it more likely ants will find the food, for now
      let fz = 0; // spawn on surface
      foods.set(get3dHash(fx, fy, fz), {x:fx,y:fy,z:fz,carry:false});
    }
  }

  // eggs hatch
  /*
  for(let i=eggs.length-1;i>=0;i--){
    eggs[i].timer--;
    if(eggs[i].timer<=0){
      let col=colonies.find(c=>c.name==eggs[i].colony);
      col.workers.push({x:eggs[i].x+0.5, y:eggs[i].y+0.5, path:null, pathIndex:0});
      map[eggs[i].y][eggs[i].x]=TILE.EMPTY;
      eggs.splice(i,1);
    }
  }
  */
	
    // keyboard – accumulate velocity and then scale by delta
      let dx=0, dy=0, dz=0;
	let ex=0, ey=0, ez=0;
	
	//player 1
  if(currentView === 'nest') {
    if(keys['w']) dz -= PLAYER_SPEED;
    if(keys['s']) dz += PLAYER_SPEED;
    if(keys['a']) dx -= PLAYER_SPEED;
    if(keys['d']) dx += PLAYER_SPEED;
  } else {
    //in overworld view, vertical movement is along x axis instead of z
    if(keys['w']) dx -= PLAYER_SPEED;
    if(keys['s']) dx += PLAYER_SPEED;
    if(keys['a']) dy -= PLAYER_SPEED;
    if(keys['d']) dy += PLAYER_SPEED;
  }
	
	// Clamp player 1 to appropriate map bounds
	//let maxX = (currentView === 'nest') ? WORLD_X_MAX - 1 : COLS - 1;
  colonies[0].player.x=Math.max(0,Math.min(WORLD_X_MAX-1,colonies[0].player.x + dx * delta));
  colonies[0].player.y=Math.max(0,Math.min(WORLD_Y_MAX-1,colonies[0].player.y + dy * delta));
  colonies[0].player.z=Math.max(0,Math.min(WORLD_Z_MAX-1,colonies[0].player.z + dz * delta));
	

	
	// pickup/drop with 'e'
	if(keys['e']){
		keys['e']=false; // prevent repeat
		let tx=Math.floor(colonies[0].player.x)
    let ty=Math.floor(colonies[0].player.y);
    let tz = Math.floor(colonies[0].player.z);
		let viewMap = getViewMap();
    let block = getBlockAt(tx, ty, tz);
    if(!colonies[0].player.carrying){
      if(isTileType(block, TILE.FOOD) || isTileType(block, TILE.EGG)){
        colonies[0].player.carrying=getBlockAt(tx, ty, tz);
        setBlock(tx, ty, tz, TILE.EMPTY);
		  }
		}else{
      if(isTileType(block, TILE.EMPTY)){
        //drop carried item
        setBlock(tx, ty, tz, colonies[0].player.carrying);
        colonies[0].player.carrying = null;
		  }
		}
	}
	

	//player 2
  if(currentView === 'nest') {
    if(keys['ArrowUp']) ez -= PLAYER_SPEED;
    if(keys['ArrowDown']) ez += PLAYER_SPEED;
    if(keys['ArrowLeft']) ex -= PLAYER_SPEED;
    if(keys['ArrowRight']) ex += PLAYER_SPEED;
  } else {
    //in overworld view, vertical movement is along x axis instead of z
    if(keys['ArrowLeft']) ey -= PLAYER_SPEED;
    if(keys['ArrowRight']) ey += PLAYER_SPEED;
    if(keys['ArrowUp']) ex -= PLAYER_SPEED;
    if(keys['ArrowDown']) ex += PLAYER_SPEED;
  }
  colonies[1].player.x=Math.max(0,Math.min(WORLD_X_MAX-1,colonies[1].player.x+ex * delta));
  colonies[1].player.y=Math.max(0,Math.min(WORLD_Y_MAX-1,colonies[1].player.y+ey * delta));
	colonies[1].player.z=Math.max(0,Math.min(WORLD_Z_MAX-1,colonies[1].player.z+ez * delta));
		

   colonies.forEach((col,idx)=>{
  
      //hatch eggs
      const eggKeysToDelete = [];
      col.eggs.forEach((egg, key)=>{
        if(egg) {
          egg.timer -= delta;
          if(egg.timer <= 0) {
               // Check entity limit before hatching
               let totalEntities = countTotalEntities();
               if(totalEntities < maxEntities) {
                  if(egg.type == ANT_TYPE.SOLDIER) {
                     col.soldiers.push({x:egg.x+0.5, y:egg.y+0.5, z:egg.z+0.5, path:null, pathIndex:0, colIdx:idx, type:ANT_TYPE.SOLDIER});
                  }
                  else {
                     col.workers.push({x:egg.x+0.5, y:egg.y+0.5, z:egg.z+0.5, path:null, pathIndex:0, colIdx:idx, type:ANT_TYPE.WORKER});
                  }
               }
               eggKeysToDelete.push(key);
            }
         }
      });
      eggKeysToDelete.forEach(key => col.eggs.delete(key)); // eggs removed after hatching
      /*
      for(let i = col.eggs.length-1; i >= 0; i--) {
         col.eggs[i].timer--;
         if(col.eggs[i].timer<=0){
            if(col.eggs[i].type == ANT_TYPE.SOLDIER) {
               col.soldiers.push({x:col.eggs[i].x+0.5, y:col.eggs[i].y+0.5, path:null, pathIndex:0, type:ANT_TYPE.SOLDIER});
            }
            else {
               col.workers.push({x:col.eggs[i].x+0.5, y:col.eggs[i].y+0.5, path:null, pathIndex:0, type:ANT_TYPE.WORKER});
            }
            //map[col.eggs[i].y][col.eggs[i].x] = TILE.EMPTY;
            col.eggs.splice(i,1);
         }
      }
      */
      
      //hatch spiders
      for(let i = spiders.length-1; i >= 0; i--) {
        if(spiders[i].timer >= 0) {
          spiders[i].timer -= delta;
        }
        if(spiders[i].cooldownTimer >= 0) {
          spiders[i].cooldownTimer -= delta;
        }
      }
        
      
       let player = col.player;
       


       // click target
       if(col.playerTarget){
         let ddx = col.playerTarget.x - player.x;
         let ddy = col.playerTarget.y - player.y;
         let ddz = col.playerTarget.z - player.z;
         let dist=Math.sqrt(ddx*ddx+ddy*ddy+ddz*ddz);
           if(dist>0.1) {
             //TODO this is going to create some weird behavior through nest walls. 
             // We should ideally check if the target is reachable before setting it,
             // and if not maybe find a nearby reachable tile to move towards instead?
             let speed = PLAYER_SPEED * delta;
             player.x += speed * ddx/dist;
             player.y += speed * ddy/dist;
             player.z += speed * ddz/dist;
         }
         else {
          col.playerTarget=null;
         }
       }

      let tx=Math.floor(player.x), ty=Math.floor(player.y), tz=Math.floor(player.z);
      // when interacting we always work with the 3‑D map via accessors
      // dig
      if(isDiggableTile(getBlockAt(tx, ty, tz))) {
        damageTileAt(tx, ty, tz, 10);
         drawBackground(bgCtx);
      }
      // pickup egg
      if(!player.carrying && col.eggs.has(get3dHash(tx, ty, tz))){
         player.carrying=TILE.EGG;
         col.eggs.get(get3dHash(tx, ty, tz)).carry = true;
      }
      // pickup food
      else if(!player.carrying && foods.has(get3dHash(tx, ty, tz))){
         player.carrying = TILE.FOOD;
         foods.delete(get3dHash(tx, ty, tz));
      }

      // spawn worker
      if(tx == col.nest.x && ty == col.nest.y && tz == col.nest.z && player.carrying){
         if(player.carrying == TILE.FOOD) { player.score++; spawnEggNearNest(col, ANT_TYPE.WORKER); }
         if(player.carrying == TILE.EGG) {
            col.workers.push({x:col.nest.x, y:col.nest.y, z:col.nest.z, carrying:null, target:null, path:null, pathIndex:0, colIdx:idx, type:ANT_TYPE.WORKER});
         }
         player.carrying = null;
      }
      // spawn soldier
      if(tx == col.nest.sX && ty == col.nest.sY && tz == col.nest.z && player.carrying) {
         if(player.carrying == TILE.FOOD) { player.score++; spawnEggNearNest(col, ANT_TYPE.SOLDIER); }
         if(player.carrying==TILE.EGG) {
            col.soldiers.push({x:col.nest.sX, y:col.nest.sY, z:col.nest.z, carrying:null, target:null, path:null, pathIndex:0, type:ANT_TYPE.SOLDIER});
         }
         player.carrying=null;
      }

      // workers: find food
      col.workers.forEach(ant=>{
         if(!ant.path){
           if(foods.size > 0){
              let target = getRandMap(foods);
              ant.target=target;
              ant.path=findPath(Math.floor(ant.x),Math.floor(ant.y),Math.floor(ant.z),
                  Math.floor(target.x),Math.floor(target.y),Math.floor(target.z), PATH_TOLERANCE);
              ant.pathIndex=0;
                if (!ant.path && isSolidTile(getBlockAt(Math.floor(target.x), Math.floor(target.y), Math.floor(target.z)))) {
                  // If no path found and target is dirt, the food is stuck inside a block. Remove the food so ants can try again
                  foods.delete(get3dHash(Math.floor(target.x), Math.floor(target.y), Math.floor(target.z)));
                }
           }else{
            //no food found, wander to a random nearby empty tile in WANDER_DIST radius
            let wander=getRandomNearbyEmptyTile(Math.floor(ant.x),Math.floor(ant.y),Math.floor(ant.z), WANDER_DIST);
            if(wander){
              ant.target=wander;
              ant.path=findPath(Math.floor(ant.x),Math.floor(ant.y),Math.floor(ant.z),wander.x,wander.y,wander.z, PATH_TOLERANCE * 2.0);
              ant.pathIndex=0;
            }
         }
         }
         if(ant.path && ant.pathIndex<ant.path.length) {
           let next=ant.path[ant.pathIndex];
           let baseDx=next.x+0.5 - ant.x, baseDy=next.y+0.5 - ant.y, baseDz=next.z+0.5 - ant.z;
           let moveDx = baseDx, moveDy = baseDy, moveDz = baseDz;
           let len=Math.sqrt(moveDx*moveDx+moveDy*moveDy+moveDz*moveDz);
          //  const jitter = getPathJitter(ant, delta, 0.16);
          //  let dx=next.x+0.5 + jitter.x - ant.x;
          //  let dy=next.y+0.5 + jitter.y - ant.y;
          //  let dz=next.z+0.5 + jitter.z - ant.z;
          //  let len=Math.sqrt(dx*dx+dy*dy+dz*dz);
           if(len<0.1){ 
            ant.x=next.x+0.5; ant.y=next.y+0.5; ant.z=next.z+0.5; ant.pathIndex++;
           }
           else{ 
            let speed = ANT_SPEED * delta;
            let nextX = ant.x + speed * moveDx/len;
            let nextY = ant.y + speed * moveDy/len;
            let nextZ = ant.z + speed * moveDz/len;
            if(!isMoveOutsideWorld(nextX, nextY, nextZ)) {
              ant.x = nextX;
              ant.y = nextY;
              ant.z = nextZ;
            }
           }
         } else { ant.path=null; }

         let antX = Math.floor(ant.x), antY = Math.floor(ant.y), antZ = Math.floor(ant.z);
         // dig at ant's current location
        if(isDiggableTile(getBlockAt(antX, antY, antZ))) {
          damageTileAt(antX, antY, antZ, 10);
            drawBackground(bgCtx);
         }
         // pick up food
         if(!ant.carrying && foods.has(get3dHash(antX, antY, antZ))){
            ant.carrying = TILE.FOOD;
            foods.delete(get3dHash(antX, antY, antZ));
            ant.target = {x:col.nest.x, y:col.nest.y, z:col.nest.z};
            ant.path = findPath(antX, antY, antZ, col.nest.x, col.nest.y, col.nest.z, PATH_TOLERANCE);
            ant.pathIndex = 0;
         }
         // deliver food
         if(ant.carrying == TILE.FOOD && antX == col.nest.x && antY == col.nest.y && antZ == col.nest.z) {
            col.score++; ant.carrying = null; ant.target = null; ant.path = null;
            spawnEggNearNest(col, ANT_TYPE.WORKER);
         }
         
      });
      
      // soldiers: find spiders
      col.soldiers.forEach(ant=>{
         if(!ant.path){
           let food=null;
           for(let i=0; i < spiders.length; i++) {
               //if(spiders[i].timer == -1) {
               //   food = {spiders[i].x, spiders[i].y};
               //   break;
               //}
           }
           if(food){
               //let target=food[Math.floor(Math.random()*food.length)];
               ant.target = food;
               ant.path=findPath(Math.floor(ant.x),Math.floor(ant.y),Math.floor(ant.z),food.x,food.y,food.z, PATH_TOLERANCE);
               ant.pathIndex=0;
           }else{
               let wander=getRandomNearbyEmptyTile(Math.floor(ant.x),Math.floor(ant.y),Math.floor(ant.z),5);
               if(wander){
                 ant.target=wander;
                 ant.path=findPath(Math.floor(ant.x),Math.floor(ant.y),Math.floor(ant.z),wander.x,wander.y,wander.z, PATH_TOLERANCE * 2.0); ant.pathIndex=0;
               }
            }
         }
         if(ant.path && ant.pathIndex<ant.path.length) {
           let next=ant.path[ant.pathIndex];
           let baseDx=next.x+0.5 - ant.x, baseDy=next.y+0.5 - ant.y, baseDz=next.z+0.5 - ant.z;
           let moveDx = baseDx, moveDy = baseDy, moveDz = baseDz;
           let len=Math.sqrt(moveDx*moveDx+moveDy*moveDy+moveDz*moveDz);
          //  const jitter = getPathJitter(ant, delta, 0.14);
          //  let dx=next.x+0.5 + jitter.x - ant.x;
          //  let dy=next.y+0.5 + jitter.y - ant.y;
          //  let dz=next.z+0.5 + jitter.z - ant.z;
          //  let len=Math.sqrt(dx*dx+dy*dy+dz*dz);
           if(len<0.1){ ant.x=next.x+0.5; ant.y=next.y+0.5; ant.z=next.z+0.5; ant.pathIndex++; }
           else{
             let speed = ANT_SPEED * delta;
             let nextX = ant.x + speed * moveDx/len;
             let nextY = ant.y + speed * moveDy/len;
             let nextZ = ant.z + speed * moveDz/len;
             if(!isMoveOutsideWorld(nextX, nextY, nextZ)) {
               ant.x = nextX;
               ant.y = nextY;
               ant.z = nextZ;
             }
           }
         } else { ant.path=null; }

         let antX = Math.floor(ant.x), antY = Math.floor(ant.y), antZ = Math.floor(ant.z);
         // dig
        if(isDiggableTile(getBlockAt(antX, antY, antZ))) {
          damageTileAt(antX, antY, antZ, 10);
            drawBackground(bgCtx);
         }
         // (previous food/egg logic moved into worker loop)
         
         
         //attack spider
         spiders.forEach(s=>{
            if(Math.abs(ant.x - s.x) < 0.7 && Math.abs(ant.y - s.y) < 0.7 && Math.abs(ant.z - s.z) < 0.7){
               //previously cleared via 2D map; now use setBlock if needed
               skulls.push({x:s.x,y:s.y,z:s.z,timer:300});
               //col.workers.splice(j,1);
               //spiderScore++;
               s.timer = EGG_HATCH_TIME;
            }
         });
         
      }); //END SOLDIER
  });

  // spiders chase nearest ant
  spiders.forEach(s=>{
    if (s.timer > 0) {
      return;
    }
    let nearest = getNearestAnt(s);
    if(nearest && nearest.dist < 5){
	  //chase
      if(!s.path || s.target.x!=Math.floor(nearest.ant.x)||s.target.y!=Math.floor(nearest.ant.y)||s.target.z!=Math.floor(nearest.ant.z)){
        s.path = findPath(
          Math.floor(s.x), Math.floor(s.y), Math.floor(s.z),
          Math.floor(nearest.ant.x), Math.floor(nearest.ant.y), Math.floor(nearest.ant.z),
          PATH_TOLERANCE * 1.5
        );
        s.pathIndex = 0;
		  s.target = {x:Math.floor(nearest.ant.x), y:Math.floor(nearest.ant.y), z:Math.floor(nearest.ant.z)};
      }
    }
	else {
		if(!s.target) {
			let wander=getRandomNearbyEmptyTile(Math.floor(s.x),Math.floor(s.y),Math.floor(s.z),5);
			if(wander){
			  s.target=wander;
        s.path=findPath(Math.floor(s.x),Math.floor(s.y),Math.floor(s.z),wander.x,wander.y,wander.z, PATH_TOLERANCE * 2.0); s.pathIndex=0;
			}
		}
	}
    if(s.path && s.pathIndex<s.path.length){
      let next = s.path[s.pathIndex];
      if (next.z < TILE_OPEN_SPACE || SPIDER_CAN_GO_BELOW) {
        
        let baseDx=next.x+0.5 - s.x, baseDy=next.y+0.5 - s.y, baseDz=next.z+0.5 - s.z;
        let moveDx = baseDx, moveDy = baseDy, moveDz = baseDz;
        let len=Math.sqrt(moveDx*moveDx+moveDy*moveDy+moveDz*moveDz);
        // const jitter = getPathJitter(s, delta, 0.10);
        // let dx=next.x+0.5 + jitter.x - s.x;
        // let dy=next.y+0.5 + jitter.y - s.y;
        // let dz=next.z+0.5 + jitter.z - s.z;
        // let len=Math.sqrt(dx*dx+dy*dy+dz*dz);
        if(len < 0.1) { 
          s.x = next.x+0.5;
          s.y = next.y+0.5;
          s.z = next.z+0.5;
          s.pathIndex++;
        }
        else{ 
          let speed = SPIDER_SPEED * delta;
          let nextX = s.x + speed * moveDx/len;
          let nextY = s.y + speed * moveDy/len;
          let nextZ = s.z + speed * moveDz/len;
          if(!isMoveOutsideWorld(nextX, nextY, nextZ)) {
            s.x = nextX;
            s.y = nextY;
            s.z = nextZ;
          }
        }

      }
        
    }
	else { 
		s.path=null;
		s.target=null;
	}
   
   if (s.cooldownTimer <= 0) {
      colonies.forEach(col=>{
         for(let j=col.workers.length-1; j>=0; j--){
            let w=col.workers[j];
            
            //spider eats ant
            if(Math.abs(w.x - s.x) < 0.7 && Math.abs(w.y - s.y) < 0.7 && Math.abs(w.z - s.z) < 0.7){
               // clear the block where the ant died
               setBlock(Math.floor(w.x), Math.floor(w.y), Math.floor(w.z || 0), TILE.DIRT);
               skulls.push({x:w.x,y:w.y,z:w.z,timer:300});
               col.workers.splice(j,1);
              antDeaths++;
               spiderScore++;
               s.cooldownTimer = SPIDER_COOLDOWN;
            }
         }
      });
    }
/*
    if(player && Math.abs(player.x - s.x)<0.5 && Math.abs(player.y - s.y)<0.5){
	  //player death
      skulls.push({x:player.x,y:player.y,timer:30}); colonyScore=Math.max(0,colonyScore-1);
    }
	//worker death
    for(let j=workers.length-1;j>=0;j--){
      let w=workers[j];
      if(Math.abs(w.x - s.x)<0.5 && Math.abs(w.y - s.y)<0.5){
	  
		map[Math.floor(w.y)][Math.floor(w.x)]=TILE.DIRT;
        skulls.push({x:w.x,y:w.y,timer:30}); workers.splice(j,1); spiderScore++;
      }
    }
*/
  });
  
  for(let sk of skulls) sk.timer--;
  while(skulls.length&&skulls[0].timer<=0) skulls.shift();
}

// Shared world helpers now come from `util.js`.

function damageTileAt(x, y, z, amount = 10) {
  const tile = getBlockAt(x, y, z);
  if(!isDiggableTile(tile)) return false;
  const nextHp = (tile.hp ?? 0) - amount;
  if(nextHp <= 0) {
    setBlock(x, y, z, TILE.EMPTY);
    return true;
  }
  setBlock(x, y, z, { type: tile.type, hp: nextHp });
  return true;
}


// Get the appropriate map for a colony (always uses the colony's nest map)
// function getColonyMap(colonyIdx) {
//   return nestMaps[colonyIdx];
// }



/*
function getPathJitter(entity, delta, magnitude = 0.16) {
  entity.jitterTimer = (entity.jitterTimer || 0) - delta;
  if(entity.jitterTimer <= 0) {
    //jitterTimer determines how often the jitter direction changes, between 2.12 and 3.4 seconds
    entity.jitterTimer = 2.12 + Math.random() * 1.28;
    entity.jitterX = (Math.random() * 2 - 1) * magnitude;
    entity.jitterY = (Math.random() * 2 - 1) * magnitude;
    entity.jitterZ = (Math.random() * 2 - 1) * (magnitude * 0.6);
  }
  return { x: entity.jitterX || 0, y: entity.jitterY || 0, z: entity.jitterZ || 0 };
}
  */
   
 
///////////////////////
/* Library Functions */
///////////////////////


// Shared colony helpers now come from `util.js`.

// 2D hashing is no longer used; we switched to 3D coordinates
// function get2dHash(x, y) {
//    return `${x},${y}`;
// }

//TODO remove for now, but use in future to reduce the number of nest slices per Y
// function convertToWorldLocation(x, y, z) {
//     return {x:x, y: Math.floor(y/OVERWORLD_Y_RATIO) * OVERWORLD_Y_RATIO, z: z};
// }

// track the last timestamp so we can compute a delta
let _lastTimestamp = performance.now();
function gameLoop(timestamp) {
  // rAF passes a high-resolution timestamp
  let delta = (timestamp - _lastTimestamp) / 1000;
  _lastTimestamp = timestamp;

  const instantFps = delta > 0 ? 1 / delta : 0;
  fpsSmoothed = fpsSmoothed * 0.9 + instantFps * 0.1;
  const workersCount = colonies.reduce((total, col) => total + col.workers.length, 0);
  const soldiersCount = colonies.reduce((total, col) => total + col.soldiers.length, 0);
  const totalAnts = workersCount + soldiersCount;

  window.updateStats(Math.round(fpsSmoothed), viewZoom, totalAnts, antDeaths, workersCount, soldiersCount, spiders.length, foods.size);

  update(delta);         // move ants, spawn eggs, AI
  drawBackground(bgCtx); // redraw background with camera offset
  drawForeground(fgCtx); // redraw moving things
  if(showDebugPaths) drawDebug(dbgCtx);
  requestAnimationFrame(gameLoop);
}

drawBackground(bgCtx);
// start the loop, pass initial timestamp so dt is valid
requestAnimationFrame(gameLoop);

});
