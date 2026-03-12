
// ─── Color utilities ───────────────────────────────────────────

export function blendColor(c1, c2, amount) {
  function hexToRgb(hex) {
    hex = hex.replace("#", "");
    return {
      r: parseInt(hex.substring(0, 2), 16),
      g: parseInt(hex.substring(2, 4), 16),
      b: parseInt(hex.substring(4, 6), 16)
    };
  }
  function rgbToHex(r, g, b) {
    return "#" +
      r.toString(16).padStart(2, '0') +
      g.toString(16).padStart(2, '0') +
      b.toString(16).padStart(2, '0');
  }

  let rgb1 = hexToRgb(c1);
  let rgb2 = hexToRgb(c2);
  const brightness = rgb1.r + rgb1.g + rgb1.b;
  if (brightness < 30) { rgb1.r = 60; rgb1.g = 40; rgb1.b = 60; }

  let r = Math.round(rgb1.r * (1 - amount) + rgb2.r * amount);
  let g = Math.round(rgb1.g * (1 - amount) + rgb2.g * amount);
  let b = Math.round(rgb1.b * (1 - amount) + rgb2.b * amount);
  return rgbToHex(r, g, b);
}

export function hexToRgba(hex, alpha = 1.0) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function toTransparentColor(color, alpha) {
  let tempCtx = document.createElement('canvas').getContext('2d');
  tempCtx.fillStyle = color;
  let computed = tempCtx.fillStyle;
  let match = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return color;
  let [_, r, g, b] = match;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}