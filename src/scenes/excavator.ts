import type { FrameContext, Scene } from '../types';
import { Excavator, BOOM_LEN, STICK_LEN } from '../game/excavator';
import { Terrain } from '../game/terrain';
import { Background } from '../game/background';
import { Truck } from '../game/truck';
import { AudioBus } from '../game/audio';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const CHEERS = ['Great job!', 'Wow!', 'Yes!', 'Amazing!', 'Hooray!', 'Yay!', 'Way to go!'];

export class ExcavatorScene implements Scene {
  private excavator!: Excavator;
  private terrain!: Terrain;
  private background!: Background;
  private truck: Truck | null = null;
  private audio = new AudioBus();
  private audioUnlocked = false;
  private initialized = false;
  private dumpInProgress = false;

  // Layout cache
  private excX = 0;
  private excScale = 0;
  private truckParkX = 0;
  private truckScale = 0;
  private groundBaseY = 0;
  private sceneWidth = 0;
  private newTruckTimer = 0;
  private trucksLoaded = 0;

  // Drag mode — bound on first pointer down, cleared on release.
  private dragMode: 'idle' | 'bucket' | 'drive' = 'idle';
  private dragPointerId: number | null = null;
  private driveOffsetX = 0;

  onEnter(ctx: FrameContext) { this.layout(ctx); }
  onResize(ctx: FrameContext) { this.layout(ctx); }

  private layout({ width, height, orientation }: FrameContext) {
    const portrait = orientation === 'portrait';
    // Lower horizon in portrait to give the bigger half of the screen to the
    // playable ground (where digging happens); landscape keeps a larger sky.
    const horizonY = portrait ? height * 0.32 : height * 0.55;
    const groundBaseY = horizonY + 6;
    this.sceneWidth = width;
    this.groundBaseY = groundBaseY;

    const baseScale = Math.min(width, height);
    // Portrait shrinks both vehicles so they don't fill the narrow screen.
    this.excScale = baseScale * (portrait ? 0.34 : 0.36);
    this.truckScale = baseScale * (portrait ? 0.24 : 0.30);
    this.excX = width * 0.18;

    // Park truck at the edge of the bucket's reach (with a small overlap into
    // the dump zone so the kid has slack). Computed instead of hard-coded so
    // the layout works at any aspect ratio.
    const armOffset = this.excScale * 0.10;
    const reach = this.excScale * (BOOM_LEN + STICK_LEN);
    const dumpZoneFromCenter = this.truckScale * 0.55;
    const desiredOverlap = this.truckScale * 0.18;
    this.truckParkX = this.excX + armOffset + reach + dumpZoneFromCenter - desiredOverlap;
    // Don't push the truck off the right edge if reach is huge.
    const maxTruckX = width - this.truckScale * 0.5;
    if (this.truckParkX > maxTruckX) this.truckParkX = maxTruckX;

    if (!this.initialized) {
      this.background = new Background(width, height, horizonY);
      this.terrain = new Terrain(width, height, groundBaseY);
    } else {
      this.background.resize(width, height, horizonY);
      this.terrain.resize(width, height, groundBaseY);
    }

    this.excavator = new Excavator(this.excX, groundBaseY, this.excScale);
    this.spawnTruck(true);
    this.initialized = true;
  }

  private spawnTruck(initial: boolean) {
    const loads = 1 + Math.floor(Math.random() * 4); // 1..4
    this.truck = new Truck(this.truckScale, this.groundBaseY, this.truckParkX, this.sceneWidth, loads);
    if (!initial) {
      // Honk on arrival once audio is unlocked
      if (this.audioUnlocked) {
        setTimeout(() => this.audio.playHonk(), 300);
      }
    }
  }

  update({ pointers, dt }: FrameContext) {
    if (!this.initialized) return;

    // Audio unlock — first pointer interaction.
    if (!this.audioUnlocked && pointers.size > 0) {
      this.audio.unlock();
      this.audioUnlocked = true;
      // Greet on first touch
      this.audio.playHonk();
    }

    this.background.update(dt);

    const exc = this.excavator;
    const terr = this.terrain;

    // Resolve / refresh the active pointer + drag mode.
    let activePointer = null;
    if (this.dragPointerId !== null) {
      activePointer = pointers.get(this.dragPointerId) ?? null;
      if (!activePointer || !activePointer.down) {
        this.dragPointerId = null;
        this.dragMode = 'idle';
        activePointer = null;
      }
    }
    if (!activePointer) {
      for (const p of pointers.values()) {
        if (p.down) {
          activePointer = p;
          this.dragPointerId = p.id;
          if (exc.isOverBody(p.x, p.y)) {
            this.dragMode = 'drive';
            this.driveOffsetX = exc.x - p.x;
          } else {
            this.dragMode = 'bucket';
          }
          break;
        }
      }
    }

    exc.driving = this.dragMode === 'drive';

    if (this.dragMode === 'drive' && activePointer) {
      // Drive: target follows pointer with locked initial offset.
      let target = activePointer.x + this.driveOffsetX;
      const minX = exc.scale * 0.5;
      let maxX = this.sceneWidth - exc.scale * 0.5;
      if (this.truck && this.truck.state !== 'leaving') {
        const blockX = this.truck.x - this.truckScale * 0.5 - exc.scale * 0.55;
        if (blockX < maxX) maxX = blockX;
      }
      if (target < minX) target = minX;
      if (target > maxX) target = maxX;
      exc.driveTo(target, dt);
      // Stow the bucket up high while driving.
      const travelX = exc.x + exc.scale * 0.45;
      const travelY = exc.y - exc.scale * 0.55;
      exc.setBucketTarget(travelX, travelY);
    } else if (this.dragMode === 'bucket' && activePointer) {
      exc.setBucketTarget(activePointer.x, activePointer.y);
    } else {
      const restX = exc.x + exc.scale * 0.55;
      const restY = exc.y - exc.scale * 0.22;
      const k = 0.04;
      exc.setBucketTarget(
        exc.targetX + (restX - exc.targetX) * k,
        exc.targetY + (restY - exc.targetY) * k,
      );
    }

    exc.update(dt, exc.y);

    // Bucket carves terrain — only on the open ground (not under the truck).
    const work = exc.getBucketWorkPoint();
    const truck = this.truck;
    const overTruck = truck && work.x > truck.x - this.truckScale * 0.55 && work.x < truck.x + this.truckScale * 0.45;
    if (exc.fill < 1 && !exc.dumping && !overTruck) {
      const carved = terr.carve(work.x, work.y, work.r, dt);
      if (carved) {
        exc.fill = Math.min(1, exc.fill + carved.volume * 0.00035);
        exc.fillMaterial = carved.material;
        if (this.audioUnlocked) this.audio.playDigBlip();
        if (Math.random() < 0.06 && 'vibrate' in navigator) navigator.vibrate?.(8);
      }
    }

    // Dump trigger — fires once per dump animation.
    if (exc.dumping && !this.dumpInProgress && exc.fill > 0) {
      const dumpX = work.x;
      const dumpY = work.y - exc.scale * 0.05;
      const wasInTruck = truck && truck.isDumpZone(dumpX, dumpY);
      if (wasInTruck && truck) {
        truck.receiveLoad(exc.fillMaterial);
        if (this.audioUnlocked) {
          this.audio.playDump();
          setTimeout(() => this.audio.playClunk(), 220);
          // Speak the count
          const n = truck.loadsReceived;
          setTimeout(() => this.audio.speak(NUMBER_WORDS[Math.min(n, 10)] + '!'), 400);
          // If that was the last load, fanfare + cheer
          if (truck.loadsReceived >= truck.loadsWanted) {
            setTimeout(() => this.audio.playFanfare(), 700);
            setTimeout(() => {
              this.audio.speak(CHEERS[Math.floor(Math.random() * CHEERS.length)]);
            }, 1100);
          }
        }
      } else {
        // Ground pile dump
        terr.dump(dumpX, dumpY, exc.fill * 1500, exc.fillMaterial);
        if (this.audioUnlocked) this.audio.playDump();
      }
      this.dumpInProgress = true;
      if ('vibrate' in navigator) navigator.vibrate?.(20);
    }
    if (!exc.dumping) this.dumpInProgress = false;

    // Truck cycle
    if (truck) {
      truck.update(dt);
      if (truck.isGone(this.sceneWidth)) {
        this.trucksLoaded++;
        this.truck = null;
        this.newTruckTimer = 1.6; // wait before next truck arrives
        if (this.audioUnlocked) this.audio.playEnginePuff();
      }
    } else if (this.newTruckTimer > 0) {
      this.newTruckTimer -= dt;
      if (this.newTruckTimer <= 0) this.spawnTruck(false);
    }

    terr.update(dt);
  }

  render({ ctx, width, height }: FrameContext) {
    if (!this.initialized) return;

    // Sky-color backdrop guarantees no leftover pixels from prior frames.
    ctx.fillStyle = '#73b6e3';
    ctx.fillRect(0, 0, width, height);

    this.background.draw(ctx);
    this.terrain.draw(ctx);
    this.truck?.draw(ctx);
    this.excavator.draw(ctx);

    // Trucks-loaded star count (top-right) — concrete, visible reward.
    this.drawStarCount(ctx, width, height);

    // First-touch hint
    if (!this.audioUnlocked) {
      ctx.fillStyle = 'rgba(58,40,24,0.7)';
      ctx.font = `bold ${Math.round(Math.min(width, height) * 0.04)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('Tap to start!', width / 2, height - 24);
    } else {
      ctx.fillStyle = 'rgba(58,40,24,0.55)';
      ctx.font = `${Math.round(Math.min(width, height) * 0.026)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('drag bucket to dig  •  drag the digger to drive', width / 2, height - 14);
    }
  }

  private drawStarCount(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (this.trucksLoaded === 0) return;
    const padX = 16, padY = 14;
    const sz = Math.min(width, height) * 0.06;
    const label = `${this.trucksLoaded}`;
    ctx.font = `bold ${Math.round(sz * 0.85)}px system-ui, sans-serif`;
    const txtW = ctx.measureText(label).width;
    const w = sz + 14 + txtW + 18;
    const h = sz + 12;
    const x = width - w - padX;
    const y = padY;
    // Bubble
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    this.roundRect(ctx, x, y, w, h, h * 0.4);
    ctx.fill();
    ctx.strokeStyle = '#aa5510';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Star icon
    this.drawStar(ctx, x + sz * 0.55 + 6, y + h / 2, sz * 0.42);
    // Number
    ctx.fillStyle = '#3a2818';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + sz + 14, y + h / 2 + 1);
  }

  private drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    ctx.fillStyle = '#feca57';
    ctx.strokeStyle = '#c89020';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
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
