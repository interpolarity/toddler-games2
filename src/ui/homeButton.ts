// Shared home-button widget used by every game scene to return to the menu.
// Top-right corner, large enough for a toddler finger.

export function homeButtonRect(width: number, height: number): { x: number; y: number; r: number } {
  const r = Math.min(width, height) * 0.05;
  return { x: width - r - 16, y: r + 16, r };
}

export function drawHomeButton(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const { x, y, r } = homeButtonRect(width, height);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#aa5510';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // House icon
  ctx.fillStyle = '#aa5510';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.55, y + r * 0.05);
  ctx.lineTo(x, y - r * 0.55);
  ctx.lineTo(x + r * 0.55, y + r * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - r * 0.4, y - r * 0.05, r * 0.8, r * 0.55);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(x - r * 0.13, y + r * 0.18, r * 0.26, r * 0.32);
}

export function isOverHomeButton(px: number, py: number, width: number, height: number): boolean {
  const { x, y, r } = homeButtonRect(width, height);
  const dx = px - x;
  const dy = py - y;
  return dx * dx + dy * dy <= (r * 1.2) * (r * 1.2);
}
