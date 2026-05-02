import type { FrameContext, Scene } from '../types';
import { Excavator } from '../game/excavator';
import { Terrain } from '../game/terrain';
import { Background } from '../game/background';

export class ExcavatorScene implements Scene {
  private excavator!: Excavator;
  private terrain!: Terrain;
  private background!: Background;
  private initialized = false;
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
      if ('vibrate' in navigator) navigator.vibrate?.(20);
    }
    if (!exc.dumping) this.dumpInProgress = false;

    terr.update(dt);
  }

  render({ ctx, width, height }: FrameContext) {
    if (!this.initialized) return;

    // Backdrop fill — guarantees no leftover pixels from prior frames in any
    // region that downstream draws might miss (e.g. strip between horizon and
    // top of terrain). Sky color so it blends if anything peeks through.
    ctx.fillStyle = '#73b6e3';
    ctx.fillRect(0, 0, width, height);

    this.background.draw(ctx);
    this.terrain.draw(ctx);
    this.excavator.draw(ctx);

    // Hint (bottom)
    ctx.fillStyle = 'rgba(58,40,24,0.55)';
    ctx.font = `${Math.round(Math.min(width, height) * 0.025)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('drag the bucket — dig down, lift high to dump', width / 2, height - 14);
  }
}
