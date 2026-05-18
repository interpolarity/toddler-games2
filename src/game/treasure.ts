import type { Terrain } from './terrain';

export type TreasureType = 'bone' | 'gem' | 'chest';

interface Treasure {
  id: number;
  type: TreasureType;
  // World coordinates of the buried position.
  worldX: number;
  worldY: number;
  state: 'buried' | 'revealed' | 'arcing' | 'collected';
  bobPhase: number;
  revealedAt: number;
  // Screen-space arc state — set when arc starts.
  arcStartScreenX: number;
  arcStartScreenY: number;
  arcTargetX: number;
  arcTargetY: number;
  arcT: number; // 0..1
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

const REVEAL_BOB_TIME = 1.4; // seconds bobbing before arcing to tray
const ARC_DURATION = 0.85; // seconds of arc

export interface TreasureCallbacks {
  onReveal(type: TreasureType): void;
  onCollect(type: TreasureType): void;
}

export class TreasureField {
  treasures: Treasure[] = [];
  collected: Record<TreasureType, number> = { bone: 0, gem: 0, chest: 0 };
  private sparks: Spark[] = [];
  private nextId = 0;

  constructor(worldWidth: number, terrain: Terrain) {
    this.generate(worldWidth, terrain);
  }

  totalCount(): number {
    return this.treasures.length;
  }

  foundCount(): number {
    return this.collected.bone + this.collected.gem + this.collected.chest;
  }

  isComplete(): boolean {
    return this.totalCount() > 0 && this.foundCount() === this.totalCount();
  }

  private generate(worldWidth: number, terrain: Terrain) {
    // ~1 treasure per 220 world px, minimum 6.
    const count = Math.max(6, Math.floor(worldWidth / 220));
    const placed: number[] = [];
    const minSpacing = 110;
    for (let i = 0; i < count; i++) {
      let x = 0;
      for (let attempt = 0; attempt < 24; attempt++) {
        x = 120 + Math.random() * (worldWidth - 240);
        if (placed.every(p => Math.abs(p - x) >= minSpacing)) break;
      }
      placed.push(x);

      const r = Math.random();
      const type: TreasureType = r < 0.50 ? 'bone' : r < 0.85 ? 'gem' : 'chest';
      let depth: number;
      if (type === 'bone') depth = 22 + Math.random() * 30;        // 22..52
      else if (type === 'gem') depth = 38 + Math.random() * 32;    // 38..70
      else depth = 30 + Math.random() * 35;                         // 30..65 (chest)
      const surfY = terrain.originalAt(x);
      this.treasures.push({
        id: this.nextId++,
        type,
        worldX: x,
        worldY: surfY + depth,
        state: 'buried',
        bobPhase: Math.random() * Math.PI * 2,
        revealedAt: 0,
        arcStartScreenX: 0,
        arcStartScreenY: 0,
        arcTargetX: 0,
        arcTargetY: 0,
        arcT: 0,
      });
    }
  }

  // Called every frame with the terrain so newly-exposed treasures can pop.
  checkReveals(terrain: Terrain, callbacks: TreasureCallbacks) {
    for (const t of this.treasures) {
      if (t.state !== 'buried') continue;
      const surface = terrain.groundYAt(t.worldX);
      // Surface y has grown larger than treasure y → dirt above is gone.
      if (surface >= t.worldY - 2) {
        t.state = 'revealed';
        t.revealedAt = performance.now() / 1000;
        this.spawnReveal(t);
        callbacks.onReveal(t.type);
      }
    }
  }

  private spawnReveal(t: Treasure) {
    const colors = t.type === 'gem'
      ? ['#a8e0ff', '#fff', '#3a9adf', '#cce8ff']
      : t.type === 'chest'
      ? ['#feca57', '#fff', '#ffd97a', '#a87420']
      : ['#fff', '#ffe680', '#fef9ed', '#ffd6a5'];
    for (let i = 0; i < 26; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
      const speed = 90 + Math.random() * 110;
      this.sparks.push({
        x: t.worldX,
        y: t.worldY - 4,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 60,
        life: 0.6 + Math.random() * 0.5,
        size: 2 + Math.random() * 3,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  // Called by the scene each frame. cameraX needed for screen-space arc start.
  update(
    dt: number,
    cameraX: number,
    trayTargets: Record<TreasureType, { x: number; y: number }>,
    callbacks: TreasureCallbacks,
  ) {
    const now = performance.now() / 1000;
    for (const t of this.treasures) {
      if (t.state === 'revealed') {
        t.bobPhase += dt * 4;
        if (now - t.revealedAt > REVEAL_BOB_TIME) {
          t.state = 'arcing';
          t.arcStartScreenX = t.worldX - cameraX;
          t.arcStartScreenY = t.worldY - 18 + Math.sin(t.bobPhase) * 3;
          t.arcTargetX = trayTargets[t.type].x;
          t.arcTargetY = trayTargets[t.type].y;
          t.arcT = 0;
        }
      } else if (t.state === 'arcing') {
        t.arcT += dt / ARC_DURATION;
        if (t.arcT >= 1) {
          t.state = 'collected';
          this.collected[t.type] += 1;
          callbacks.onCollect(t.type);
        }
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 240 * dt;
      s.vx *= Math.pow(0.4, dt);
      s.life -= dt;
      if (s.life <= 0) this.sparks.splice(i, 1);
    }
  }

  // Drawn inside the camera transform — for buried/revealed/sparkle items
  // that live in world space.
  drawInWorld(ctx: CanvasRenderingContext2D) {
    for (const t of this.treasures) {
      if (t.state !== 'revealed') continue;
      const wobble = Math.sin(t.bobPhase) * 3;
      const drawY = t.worldY - 18 + wobble;
      // Soft glow halo
      const halo = ctx.createRadialGradient(t.worldX, drawY, 0, t.worldX, drawY, 28);
      halo.addColorStop(0, 'rgba(255, 245, 200, 0.55)');
      halo.addColorStop(1, 'rgba(255, 245, 200, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(t.worldX - 30, drawY - 30, 60, 60);
      this.drawTreasure(ctx, t.worldX, drawY, t.type, 1);
    }
    // Sparkles in world space too
    for (const s of this.sparks) {
      const a = Math.min(1, s.life * 1.6);
      ctx.globalAlpha = a;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Drawn outside the camera transform — for the arcing treasures heading to
  // the tray. Screen-space so the trajectory looks clean even if the camera
  // scrolls during the arc.
  drawInScreen(ctx: CanvasRenderingContext2D) {
    for (const t of this.treasures) {
      if (t.state !== 'arcing') continue;
      const k = Math.min(1, t.arcT);
      const x = t.arcStartScreenX + (t.arcTargetX - t.arcStartScreenX) * k;
      // Parabolic arc — peaks above the straight-line path.
      const apex = 90;
      const y = t.arcStartScreenY + (t.arcTargetY - t.arcStartScreenY) * k - Math.sin(k * Math.PI) * apex;
      // Shrink slightly as it nears tray (sense of depth).
      const scale = 1 - k * 0.35;
      this.drawTreasure(ctx, x, y, t.type, scale);
    }
  }

  drawTray(ctx: CanvasRenderingContext2D, screenWidth: number, screenHeight: number): Record<TreasureType, { x: number; y: number }> {
    const sz = Math.min(screenWidth, screenHeight) * 0.06;
    const padX = 14;
    const padY = 14;
    const slotH = sz * 1.5;
    const panelW = sz * 2.6;
    const panelH = slotH * 3 + 14;
    const x = padX;
    const y = padY;

    // Panel background — flat cream with thick brown outline.
    ctx.fillStyle = '#fff6e0';
    this.roundRect(ctx, x, y, panelW, panelH, 14);
    ctx.fill();
    ctx.strokeStyle = '#4a2410';
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const types: TreasureType[] = ['bone', 'gem', 'chest'];
    const targets: Record<TreasureType, { x: number; y: number }> = {
      bone: { x: 0, y: 0 },
      gem: { x: 0, y: 0 },
      chest: { x: 0, y: 0 },
    };
    for (let i = 0; i < 3; i++) {
      const cy = y + 8 + slotH * (i + 0.5);
      const iconX = x + sz * 0.85;
      this.drawTreasure(ctx, iconX, cy, types[i], 0.75);
      // Count
      ctx.fillStyle = '#3a2818';
      ctx.font = `bold ${Math.round(sz * 0.65)}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(this.collected[types[i]]), x + panelW - 14, cy + 1);
      targets[types[i]] = { x: iconX, y: cy };
    }
    return targets;
  }

  // Public: lets the scene render a treasure icon outside this class (e.g.
  // in the win-state stat row).
  drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, type: TreasureType, scale: number) {
    this.drawTreasure(ctx, x, y, type, scale);
  }

  private drawTreasure(ctx: CanvasRenderingContext2D, x: number, y: number, type: TreasureType, scale: number) {
    if (type === 'bone') this.drawBone(ctx, x, y, scale);
    else if (type === 'gem') this.drawGem(ctx, x, y, scale);
    else this.drawChest(ctx, x, y, scale);
  }

  // Sago-style: flat fills, thick dark-brown outlines, one white highlight.
  private drawBone(ctx: CanvasRenderingContext2D, x: number, y: number, sc: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.20);
    const fill = '#fff5d8';
    const stroke = '#4a2810';
    // Combined silhouette: four round end-bumps + middle bar drawn as a
    // single path so the thick outline traces the bone shape cleanly.
    const w = 16 * sc;
    const h = 6 * sc;
    const r = 4.6 * sc;
    const endX = w / 2;
    const offY = 4.2 * sc;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(-endX, -offY, r, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(-endX, offY, r, Math.PI * 1.5, Math.PI * 0.5, true);
    ctx.lineTo(endX, offY + r);
    ctx.arc(endX, offY, r, Math.PI * 0.5, Math.PI * 1.5, true);
    ctx.arc(endX, -offY, r, Math.PI * 1.5, Math.PI * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.2 * sc;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Single highlight strip
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(-w / 2 + 2 * sc, -h / 2 + 0.5 * sc, w - 4 * sc, h * 0.30);
    ctx.restore();
  }

  private drawGem(ctx: CanvasRenderingContext2D, x: number, y: number, sc: number) {
    ctx.save();
    ctx.translate(x, y);
    const stroke = '#0e3a60';
    // Flat blue diamond — solid fill, no gradient.
    ctx.fillStyle = '#3aa5e8';
    ctx.beginPath();
    ctx.moveTo(0, -10 * sc);
    ctx.lineTo(7.5 * sc, -4 * sc);
    ctx.lineTo(8.5 * sc, 4 * sc);
    ctx.lineTo(0, 10 * sc);
    ctx.lineTo(-8.5 * sc, 4 * sc);
    ctx.lineTo(-7.5 * sc, -4 * sc);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.2 * sc;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Solid lighter top facet
    ctx.fillStyle = '#a8e0ff';
    ctx.beginPath();
    ctx.moveTo(0, -10 * sc);
    ctx.lineTo(7.5 * sc, -4 * sc);
    ctx.lineTo(0, -2 * sc);
    ctx.lineTo(-7.5 * sc, -4 * sc);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.6 * sc;
    ctx.stroke();
    // One solid white sparkle pip
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(-2 * sc, -6 * sc);
    ctx.lineTo(-1 * sc, -7.5 * sc);
    ctx.lineTo(0, -6 * sc);
    ctx.lineTo(-1 * sc, -4.5 * sc);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawChest(ctx: CanvasRenderingContext2D, x: number, y: number, sc: number) {
    ctx.save();
    ctx.translate(x, y);
    const stroke = '#3a2008';
    const bw = 24 * sc;
    const bh = 13 * sc;
    // Body — flat warm brown rounded rect
    ctx.fillStyle = '#a87440';
    this.roundRect(ctx, -bw / 2, -1 * sc, bw, bh, 3 * sc);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.4 * sc;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Lid — flat darker brown semi-ellipse
    ctx.fillStyle = '#7a4f20';
    ctx.beginPath();
    ctx.moveTo(-bw / 2, -1 * sc);
    ctx.quadraticCurveTo(0, -11 * sc, bw / 2, -1 * sc);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.4 * sc;
    ctx.stroke();
    // Lid plank lines
    ctx.strokeStyle = '#5a3818';
    ctx.lineWidth = 1.4 * sc;
    ctx.beginPath();
    ctx.moveTo(-bw / 2 + 1 * sc, -1 * sc);
    ctx.quadraticCurveTo(-bw / 4, -7 * sc, 0, -8.5 * sc);
    ctx.moveTo(0, -8.5 * sc);
    ctx.quadraticCurveTo(bw / 4, -7 * sc, bw / 2 - 1 * sc, -1 * sc);
    ctx.stroke();
    // Two flat gold metal bands
    ctx.fillStyle = '#f6c850';
    ctx.fillRect(-bw / 2, 1.5 * sc, bw, 1.6 * sc);
    ctx.fillRect(-bw / 2, 7.5 * sc, bw, 1.6 * sc);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2 * sc;
    ctx.strokeRect(-bw / 2, 1.5 * sc, bw, 1.6 * sc);
    ctx.strokeRect(-bw / 2, 7.5 * sc, bw, 1.6 * sc);
    // Lock — chunky gold square
    ctx.fillStyle = '#f6c850';
    this.roundRect(ctx, -4 * sc, -1 * sc, 8 * sc, 7 * sc, 1.4 * sc);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.8 * sc;
    ctx.stroke();
    // Keyhole
    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.arc(0, 1 * sc, 1.1 * sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-0.55 * sc, 1 * sc, 1.1 * sc, 2.8 * sc);
    // Single white highlight on the lid
    ctx.fillStyle = 'rgba(255,235,200,0.5)';
    ctx.beginPath();
    ctx.ellipse(-bw * 0.18, -6.5 * sc, bw * 0.10, 1.6 * sc, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
}
