import type { FrameContext, Scene } from '../types';
import { Excavator } from '../game/excavator';
import { Terrain } from '../game/terrain';
import { Background } from '../game/background';

export class ExcavatorScene implements Scene {
  private excavator!: Excavator;
  private terrain!: Terrain;
  private background!: Background;
  private initialized = false;
  private trips = 0;
  private dumpInProgress = false;

  onEnter(ctx: FrameContext) { this.layout(ctx); }
  onResize(ctx: FrameContext) { this.layout(ctx); }

  private layout({ width, height, orientation }: FrameContext) {
    const portrait = orientation === 'portrait';
    const horizonY = portrait ? height * 0.42 : height * 0.55;
    const groundBaseY = horizonY + 6;

    if (!this.initialized) {
      this.background = new Background(width, height, horizonY);
      this.terrain = new Terrain(width, height, groundBaseY);
    } else {
      this.background.resize(width, height, horizonY);
      this.terrain.resize(width, height, groundBaseY);
    }

    const excScale = Math.min(width, height) * (portrait ? 0.50 : 0.40);
    const excX = portrait ? width * 0.42 : width * 0.32;
    this.excavator = new Excavator(excX, groundBaseY, excScale);
    this.initialized = true;
  }

  update({ pointers, dt, width, height }: FrameContext) {
    if (!this.initialized) return;
    void width;
    void height;

    this.background.update(dt);

    const exc = this.excavator;
    const terr = this.terrain;

    // First active pointer drives the bucket target.
    let activePointer = null;
    for (const p of pointers.values()) { if (p.down) { activePointer = p; break; } }

    if (activePointer) {
      exc.setBucketTarget(activePointer.x, activePointer.y);
    } else {
      // Drift back to a comfortable rest pose just above the ground in front.
      const restX = exc.x + exc.scale * 0.55;
      const restY = exc.y - exc.scale * 0.22;
      const k = 0.04;
      exc.setBucketTarget(
        exc.targetX + (restX - exc.targetX) * k,
        exc.targetY + (restY - exc.targetY) * k,
      );
    }

    exc.update(dt, exc.y);

    // Bucket-terrain interaction
    const work = exc.getBucketWorkPoint();
    if (exc.fill < 1 && !exc.dumping) {
      const carved = terr.carve(work.x, work.y, work.r, dt);
      if (carved) {
        const fillGain = carved.volume * 0.00035;
        exc.fill = Math.min(1, exc.fill + fillGain);
        exc.fillMaterial = carved.material;
        if (Math.random() < 0.06 && 'vibrate' in navigator) {
          navigator.vibrate?.(8);
        }
      }
    }

    // Trigger dump release at start of dump animation
    if (exc.dumping && !this.dumpInProgress && exc.fill > 0) {
      const dumpSpawnX = work.x;
      const dumpSpawnY = work.y - exc.scale * 0.05;
      const volume = exc.fill * 1500;
      terr.dump(dumpSpawnX, dumpSpawnY, volume, exc.fillMaterial);
      this.dumpInProgress = true;
      this.trips++;
      if ('vibrate' in navigator) navigator.vibrate?.(20);
    }
    if (!exc.dumping) this.dumpInProgress = false;

    terr.update(dt);
  }

  render({ ctx, width, height }: FrameContext) {
    if (!this.initialized) return;

    this.background.draw(ctx);
    this.terrain.draw(ctx);
    this.excavator.draw(ctx);

    // Trip counter HUD
    if (this.trips > 0) {
      const padX = 18, padY = 14;
      const label = `🚜 ${this.trips}`;
      ctx.font = `bold ${Math.round(Math.min(width, height) * 0.045)}px system-ui, sans-serif`;
      const metrics = ctx.measureText(label);
      const w = metrics.width + 24;
      const h = Math.min(width, height) * 0.07;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      this.roundRect(ctx, width - w - padX, padY, w, h, h * 0.4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#3a2818';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, width - w / 2 - padX, padY + h / 2);
    }

    // Hint (bottom)
    ctx.fillStyle = 'rgba(58,40,24,0.55)';
    ctx.font = `${Math.round(Math.min(width, height) * 0.025)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('drag the bucket — dig down, lift high to dump', width / 2, height - 14);
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
