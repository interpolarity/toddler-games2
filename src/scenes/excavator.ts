import type { FrameContext, Scene } from '../types';
import { Excavator, BOOM_LEN, STICK_LEN } from '../game/excavator';
import { Terrain } from '../game/terrain';
import { Background } from '../game/background';
import { Truck } from '../game/truck';
import { AudioBus } from '../game/audio';
import { TreasureField, type TreasureType } from '../game/treasure';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const CHEERS = ['Great job!', 'Wow!', 'Yes!', 'Amazing!', 'Hooray!', 'Yay!', 'Way to go!'];
const TREASURE_WORDS: Record<TreasureType, string> = {
  bone: 'Bone!',
  gem: 'Diamond!',
  chest: 'Treasure!',
};

export class ExcavatorScene implements Scene {
  private excavator!: Excavator;
  private terrain!: Terrain;
  private background!: Background;
  private truck: Truck | null = null;
  private treasures!: TreasureField;
  private trayTargets: Record<TreasureType, { x: number; y: number }> = {
    bone: { x: 0, y: 0 }, gem: { x: 0, y: 0 }, chest: { x: 0, y: 0 },
  };
  private audio = new AudioBus();
  private audioUnlocked = false;
  private initialized = false;
  private dumpInProgress = false;

  // Layout cache
  private excX = 0;
  private excScale = 0;
  private truckScale = 0;
  private groundBaseY = 0;
  private sceneWidth = 0;
  private worldWidth = 0;
  private cameraX = 0;
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
    const horizonY = portrait ? height * 0.32 : height * 0.55;
    const groundBaseY = horizonY + 6;
    this.sceneWidth = width;
    this.groundBaseY = groundBaseY;
    // World is wider than the screen; camera scrolls to follow the digger.
    // Min 1500px so even narrow phones get plenty of horizontal room.
    this.worldWidth = Math.max(width * 2, 1500);

    const baseScale = Math.min(width, height);
    this.excScale = baseScale * (portrait ? 0.34 : 0.36);
    this.truckScale = baseScale * (portrait ? 0.24 : 0.30);
    // Excavator starts in the left third of the world.
    this.excX = Math.max(this.excScale * 0.6, width * 0.18);

    if (!this.initialized) {
      this.background = new Background(this.worldWidth, height, horizonY);
      this.terrain = new Terrain(this.worldWidth, height, groundBaseY);
    } else {
      this.background.resize(this.worldWidth, height, horizonY);
      this.terrain.resize(this.worldWidth, height, groundBaseY);
    }

    // Reseed treasures every layout (resize-resets the world).
    this.treasures = new TreasureField(this.worldWidth, this.terrain);

    this.excavator = new Excavator(this.excX, groundBaseY, this.excScale);
    // Place camera so the excavator starts ~30% from the left of screen.
    this.cameraX = this.clampCamera(this.excX - width * 0.30);
    this.spawnTruck(true);
    this.initialized = true;
  }

  private clampCamera(x: number): number {
    if (x < 0) return 0;
    const max = this.worldWidth - this.sceneWidth;
    if (x > max) return max;
    return x;
  }

  private spawnTruck(initial: boolean) {
    // Park near the digger's CURRENT world position so a fresh truck always
    // arrives within reach, no matter how far the kid has driven.
    const armOffset = this.excScale * 0.10;
    const reach = this.excScale * (BOOM_LEN + STICK_LEN);
    const dumpZoneFromCenter = this.truckScale * 0.55;
    const desiredOverlap = this.truckScale * 0.18;
    let parkX = this.excavator.x + armOffset + reach + dumpZoneFromCenter - desiredOverlap;
    const maxParkX = this.worldWidth - this.truckScale * 0.5;
    if (parkX > maxParkX) parkX = maxParkX;
    // Spawn off camera to the right (if reachable) or just past parkX.
    const cameraRight = this.cameraX + this.sceneWidth;
    const startX = Math.max(parkX + this.truckScale * 0.5, cameraRight + this.truckScale * 0.5);

    const loads = 1 + Math.floor(Math.random() * 4); // 1..4
    this.truck = new Truck(this.truckScale, this.groundBaseY, parkX, startX, loads);
    if (!initial && this.audioUnlocked) {
      setTimeout(() => this.audio.playHonk(), 300);
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
          // Convert pointer to world space for hit-test.
          const worldX = p.x + this.cameraX;
          if (exc.isOverBody(worldX, p.y)) {
            this.dragMode = 'drive';
            this.driveOffsetX = exc.x - worldX;
          } else {
            this.dragMode = 'bucket';
          }
          break;
        }
      }
    }

    exc.driving = this.dragMode === 'drive';

    if (this.dragMode === 'drive' && activePointer) {
      // Drive: target follows pointer (in world space) with locked offset.
      const worldX = activePointer.x + this.cameraX;
      let target = worldX + this.driveOffsetX;
      const minX = exc.scale * 0.5;
      let maxX = this.worldWidth - exc.scale * 0.5;
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
      const worldX = activePointer.x + this.cameraX;
      exc.setBucketTarget(worldX, activePointer.y);
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

    // Camera follows the digger smoothly — keeps it about 30% from the
    // left so there's room to see the dig area and truck on the right.
    const targetCamX = this.clampCamera(exc.x - this.sceneWidth * 0.30);
    const camLerp = 1 - Math.pow(0.0001, dt);
    this.cameraX += (targetCamX - this.cameraX) * camLerp;

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
      const cameraRight = this.cameraX + this.sceneWidth;
      if (truck.isGone(cameraRight)) {
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

    // Treasures — reveal anything newly exposed by the latest carve, then
    // step bobs / arcs. Voice + sparkle sound on reveal; ding on collect.
    const treasureCb = {
      onReveal: (type: TreasureType) => {
        if (this.audioUnlocked) {
          this.audio.playSparkle();
          setTimeout(() => this.audio.speak(TREASURE_WORDS[type]), 220);
        }
        if ('vibrate' in navigator) navigator.vibrate?.(15);
      },
      onCollect: (_type: TreasureType) => {
        if (this.audioUnlocked) this.audio.playCollect();
      },
    };
    this.treasures.checkReveals(terr, treasureCb);
    this.treasures.update(dt, this.cameraX, this.trayTargets, treasureCb);
  }

  render({ ctx, width, height }: FrameContext) {
    if (!this.initialized) return;

    // Sky-color backdrop guarantees no leftover pixels from prior frames.
    ctx.fillStyle = '#73b6e3';
    ctx.fillRect(0, 0, width, height);

    // World draws are scrolled by the camera. Background, terrain, truck,
    // and excavator are all positioned in world space.
    ctx.save();
    ctx.translate(-this.cameraX, 0);
    this.background.draw(ctx);
    this.terrain.draw(ctx);
    this.treasures.drawInWorld(ctx);
    this.truck?.draw(ctx);
    this.excavator.draw(ctx);
    ctx.restore();

    // HUD is in screen space (no camera offset). Tray returns the world-fixed
    // screen positions of each slot so arcing treasures know where to fly.
    this.trayTargets = this.treasures.drawTray(ctx, width, height);
    this.treasures.drawInScreen(ctx);
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
