import type { FrameContext, Scene, SceneNavigator, SceneId } from '../types';

interface Tile {
  id: SceneId;
  label: string;
  bg: string;
  accent: string;
  icon: (ctx: CanvasRenderingContext2D, x: number, y: number, sz: number) => void;
}

interface PlacedTile extends Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class MenuScene implements Scene {
  private nav: SceneNavigator;
  private placed: PlacedTile[] = [];
  private pressedIdx = -1;
  private pressTimer = 0;
  private titleBob = 0;

  constructor(nav: SceneNavigator) {
    this.nav = nav;
  }

  onEnter(ctx: FrameContext) { this.layout(ctx); }
  onResize(ctx: FrameContext) { this.layout(ctx); }

  private layout({ width, height, orientation }: FrameContext) {
    const portrait = orientation === 'portrait';
    const tiles: Tile[] = [
      { id: 'excavator', label: 'Digger', bg: '#a8d6ee', accent: '#2a5a82', icon: drawExcavatorIcon },
      { id: 'pizza',     label: 'Pizza',  bg: '#ffd5a5', accent: '#aa5510', icon: drawPizzaIcon },
      { id: 'burger',    label: 'Burger', bg: '#ffd97a', accent: '#9a3a08', icon: drawBurgerIcon },
    ];

    // Tile grid — 1 column in narrow portrait, otherwise 3.
    const cols = portrait && width < 500 ? 1 : 3;
    const rows = Math.ceil(tiles.length / cols);
    const gridTop = height * 0.30;
    const gridBottom = height * 0.92;
    const gridH = gridBottom - gridTop;
    const sideMargin = width * 0.06;
    const gap = 16;
    const tileW = (width - sideMargin * 2 - gap * (cols - 1)) / cols;
    const tileH = Math.min((gridH - gap * (rows - 1)) / rows, tileW * 1.05);

    this.placed = tiles.map((tile, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = sideMargin + col * (tileW + gap);
      const y = gridTop + row * (tileH + gap);
      return { ...tile, x, y, w: tileW, h: tileH };
    });
  }

  update({ pointers, dt, width, height }: FrameContext) {
    void width; void height;
    this.titleBob += dt;

    if (this.pressedIdx >= 0) {
      this.pressTimer += dt;
      if (this.pressTimer >= 0.18) {
        // Commit the navigation after a quick press animation.
        const tile = this.placed[this.pressedIdx];
        this.pressedIdx = -1;
        this.pressTimer = 0;
        this.nav.go(tile.id);
        return;
      }
      return;
    }

    for (const p of pointers.values()) {
      if (!p.down) continue;
      const idx = this.placed.findIndex(
        t => p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h,
      );
      if (idx >= 0) {
        this.pressedIdx = idx;
        this.pressTimer = 0;
      }
      break;
    }
  }

  render({ ctx, width, height }: FrameContext) {
    // Cheerful sky gradient
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#84caf0');
    bg.addColorStop(1, '#dff0fa');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Title
    const titleSize = Math.min(width, height) * 0.10;
    const titleY = height * 0.15 + Math.sin(this.titleBob * 2.2) * 4;
    ctx.font = `900 ${Math.round(titleSize)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(6, titleSize * 0.10);
    ctx.strokeStyle = '#fff';
    ctx.strokeText('Toddler Games', width / 2, titleY);
    const titleGrad = ctx.createLinearGradient(0, titleY - titleSize / 2, 0, titleY + titleSize / 2);
    titleGrad.addColorStop(0, '#ff8c42');
    titleGrad.addColorStop(1, '#aa3a08');
    ctx.fillStyle = titleGrad;
    ctx.fillText('Toddler Games', width / 2, titleY);

    // Subtitle / hint
    ctx.font = `${Math.round(titleSize * 0.32)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(58,40,24,0.7)';
    ctx.fillText('Pick a game!', width / 2, titleY + titleSize * 0.7);

    // Tiles
    this.placed.forEach((tile, i) => {
      const pressed = i === this.pressedIdx;
      const scale = pressed ? 1 - 0.06 * Math.sin(this.pressTimer / 0.18 * Math.PI) : 1;
      const cx = tile.x + tile.w / 2;
      const cy = tile.y + tile.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-tile.w / 2, -tile.h / 2);
      // Tile bg
      const tileGrad = ctx.createLinearGradient(0, 0, 0, tile.h);
      tileGrad.addColorStop(0, tile.bg);
      tileGrad.addColorStop(1, this.shade(tile.bg, -0.1));
      ctx.fillStyle = tileGrad;
      this.roundRect(ctx, 0, 0, tile.w, tile.h, 18);
      ctx.fill();
      ctx.strokeStyle = tile.accent;
      ctx.lineWidth = 4;
      ctx.stroke();
      // Icon centered upper portion
      const iconSize = Math.min(tile.w, tile.h) * 0.55;
      tile.icon(ctx, tile.w / 2, tile.h * 0.42, iconSize);
      // Label
      ctx.fillStyle = tile.accent;
      ctx.font = `bold ${Math.round(Math.min(tile.w, tile.h) * 0.16)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tile.label, tile.w / 2, tile.h * 0.84);
      ctx.restore();
    });
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private shade(hex: string, amount: number): string {
    // Darken/lighten a hex color; amount in [-1, 1]
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    const adjust = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amount)));
    const [r, g, b] = [adjust(parseInt(m[1], 16)), adjust(parseInt(m[2], 16)), adjust(parseInt(m[3], 16))];
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
}

// ============ ICONS =============

function drawExcavatorIcon(ctx: CanvasRenderingContext2D, x: number, y: number, sz: number) {
  const s = sz / 100;
  ctx.save();
  ctx.translate(x, y);
  // Tracks
  ctx.fillStyle = '#1a1a1a';
  roundRectFill(ctx, -45 * s, 18 * s, 90 * s, 16 * s, 6 * s);
  ctx.fillStyle = '#3a3a3a';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(-36 * s + i * 14 * s, 26 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // Cab
  ctx.fillStyle = '#ffb84d';
  roundRectFill(ctx, -28 * s, -16 * s, 50 * s, 32 * s, 4 * s);
  ctx.strokeStyle = '#9c6a1a';
  ctx.lineWidth = 2;
  ctx.strokeRect(-28 * s, -16 * s, 50 * s, 32 * s);
  // Window
  ctx.fillStyle = '#cce8ff';
  ctx.fillRect(-22 * s, -12 * s, 28 * s, 18 * s);
  // Boom + bucket
  ctx.strokeStyle = '#ffb84d';
  ctx.lineWidth = 8 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(15 * s, -10 * s);
  ctx.lineTo(40 * s, -25 * s);
  ctx.lineTo(50 * s, 5 * s);
  ctx.stroke();
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(46 * s, 4 * s, 14 * s, 12 * s);
  ctx.restore();
}

function drawPizzaIcon(ctx: CanvasRenderingContext2D, x: number, y: number, sz: number) {
  const r = sz / 2;
  ctx.save();
  ctx.translate(x, y);
  // Crust
  ctx.fillStyle = '#c87a30';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Cheese
  ctx.fillStyle = '#fdd96a';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
  ctx.fill();
  // Sauce hint
  ctx.fillStyle = '#e8553a';
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // Pepperoni dots
  ctx.fillStyle = '#c8333a';
  const peps = [[-0.35, -0.25], [0.30, -0.30], [-0.10, 0.30], [0.40, 0.20], [-0.40, 0.15]];
  for (const [dx, dy] of peps) {
    ctx.beginPath();
    ctx.arc(dx * r, dy * r, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  // Crust outline
  ctx.strokeStyle = '#9a5818';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r - 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawBurgerIcon(ctx: CanvasRenderingContext2D, x: number, y: number, sz: number) {
  const w = sz;
  const h = sz * 0.78;
  ctx.save();
  ctx.translate(x, y);
  // Top bun (dome)
  ctx.fillStyle = '#e8a430';
  ctx.beginPath();
  ctx.moveTo(-w * 0.42, -h * 0.10);
  ctx.quadraticCurveTo(0, -h * 0.62, w * 0.42, -h * 0.10);
  ctx.closePath();
  ctx.fill();
  // Sesame seeds
  ctx.fillStyle = '#fff5d8';
  for (const [dx, dy] of [[-0.20, -0.30], [0.05, -0.40], [0.25, -0.30], [-0.05, -0.34]]) {
    ctx.beginPath();
    ctx.ellipse(dx * w, dy * h, w * 0.04, h * 0.025, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Lettuce frill
  ctx.fillStyle = '#5dba48';
  ctx.beginPath();
  ctx.moveTo(-w * 0.45, -h * 0.10);
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const px = -w * 0.45 + w * 0.9 * t;
    const py = -h * 0.10 + (i % 2 === 0 ? h * 0.06 : -h * 0.04);
    ctx.lineTo(px, py);
  }
  ctx.lineTo(w * 0.45, -h * 0.10);
  ctx.lineTo(w * 0.45, h * 0.04);
  ctx.lineTo(-w * 0.45, h * 0.04);
  ctx.closePath();
  ctx.fill();
  // Cheese
  ctx.fillStyle = '#fbcc46';
  ctx.beginPath();
  ctx.moveTo(-w * 0.42, h * 0.04);
  ctx.lineTo(w * 0.42, h * 0.04);
  ctx.lineTo(w * 0.46, h * 0.16);
  ctx.lineTo(-w * 0.46, h * 0.16);
  ctx.closePath();
  ctx.fill();
  // Patty
  ctx.fillStyle = '#7a3a18';
  roundRectFill(ctx, -w * 0.46, h * 0.10, w * 0.92, h * 0.20, 4);
  // Bottom bun
  ctx.fillStyle = '#e8a430';
  ctx.beginPath();
  ctx.moveTo(-w * 0.42, h * 0.30);
  ctx.lineTo(w * 0.42, h * 0.30);
  ctx.quadraticCurveTo(w * 0.45, h * 0.50, 0, h * 0.50);
  ctx.quadraticCurveTo(-w * 0.45, h * 0.50, -w * 0.42, h * 0.30);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#9a5818';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function roundRectFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}
