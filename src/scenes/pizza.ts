import type { FrameContext, Scene, SceneNavigator } from '../types';
import { AudioBus } from '../game/audio';
import { drawHomeButton, isOverHomeButton } from '../ui/homeButton';

type ToppingType = 'pepperoni' | 'mushroom' | 'olive' | 'pepper' | 'cheese' | 'tomato';
type Phase = 'building' | 'baking' | 'eating' | 'celebrating';

const TOPPING_TYPES: ToppingType[] = ['pepperoni', 'mushroom', 'olive', 'pepper', 'cheese', 'tomato'];

const TOPPING_NAMES: Record<ToppingType, string> = {
  pepperoni: 'Pepperoni',
  mushroom: 'Mushroom',
  olive: 'Olive',
  pepper: 'Pepper',
  cheese: 'Mozzarella',
  tomato: 'Tomato',
};

const MUNCH_WORDS = ['Yum!', 'Mmm!', 'Munch!', 'Tasty!', 'Delicious!'];

interface PlacedTopping {
  type: ToppingType;
  rx: number; // pizza-center-relative, normalized to pizza radius
  ry: number;
  rot: number;
  scale: number;
  bounceT: number; // 0..1, just-placed pop animation
}

interface TraySlot {
  type: ToppingType;
  x: number;
  y: number;
  r: number;
}

interface Slice {
  eaten: boolean;
  lift: number;       // px vertical offset while being eaten
  fade: number;       // 0..1
  /** angle of slice center from pizza center */
  angle: number;
  particles: Array<{ x: number; y: number; vx: number; vy: number; life: number; size: number; color: string }>;
}

interface OvenStream {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

export class PizzaScene implements Scene {
  private nav: SceneNavigator;
  private audio = new AudioBus();
  private audioUnlocked = false;
  private cachedWidth = 0;
  private cachedHeight = 0;

  // Phase state
  private phase: Phase = 'building';
  private bakeT = 0; // 0..1 progress through bake animation
  private celebrateAt = 0;
  private confetti: Array<{ x: number; y: number; vx: number; vy: number; rot: number; vrot: number; life: number; color: string; size: number }> = [];
  private steam: OvenStream[] = [];

  // Pizza
  private pizzaX = 0;
  private pizzaY = 0;
  private pizzaR = 0;
  private placed: PlacedTopping[] = [];
  private spokenForType: Set<ToppingType> = new Set();
  private slices: Slice[] = [];

  // Oven (slides in during baking)
  private ovenSlide = 0; // 0 = off-screen right, 1 = fully on
  private pizzaInOven = 0; // 0 = on counter, 1 = inside oven

  // Tray
  private tray: TraySlot[] = [];
  private selectedType: ToppingType = 'pepperoni';

  // Bake button
  private bakeBtn = { x: 0, y: 0, w: 0, h: 0, pulse: 0 };

  // Drag-paint state
  private paintPointerId: number | null = null;
  private paintLastX = 0;
  private paintLastY = 0;
  private paintAccum = 0;

  constructor(nav: SceneNavigator) {
    this.nav = nav;
  }

  onEnter(ctx: FrameContext) { this.layout(ctx); }
  onResize(ctx: FrameContext) { this.layout(ctx); }

  private layout({ width, height, orientation }: FrameContext) {
    this.cachedWidth = width;
    this.cachedHeight = height;
    const portrait = orientation === 'portrait';
    const baseScale = Math.min(width, height);

    // Pizza placement
    if (portrait) {
      this.pizzaX = width / 2;
      this.pizzaY = height * 0.36;
      this.pizzaR = baseScale * 0.32;
    } else {
      this.pizzaX = width * 0.36;
      this.pizzaY = height * 0.55;
      this.pizzaR = baseScale * 0.36;
    }

    // Tray (6 slots)
    const slotR = baseScale * (portrait ? 0.075 : 0.082);
    if (portrait) {
      const trayY = height * 0.78;
      const span = (TOPPING_TYPES.length - 1) * (slotR * 2.5);
      this.tray = TOPPING_TYPES.map((t, i) => ({
        type: t,
        x: width / 2 - span / 2 + i * (slotR * 2.5),
        y: trayY,
        r: slotR,
      }));
    } else {
      const trayX = width * 0.82;
      const span = (TOPPING_TYPES.length - 1) * (slotR * 2.5);
      this.tray = TOPPING_TYPES.map((t, i) => ({
        type: t,
        x: trayX,
        y: height / 2 - span / 2 + i * (slotR * 2.5),
        r: slotR,
      }));
    }

    // Bake button
    if (portrait) {
      this.bakeBtn = {
        x: width * 0.72,
        y: height * 0.92,
        w: baseScale * 0.22,
        h: baseScale * 0.10,
        pulse: 0,
      };
    } else {
      this.bakeBtn = {
        x: width * 0.36,
        y: height * 0.92,
        w: baseScale * 0.20,
        h: baseScale * 0.10,
        pulse: 0,
      };
    }
  }

  update({ pointers, dt }: FrameContext) {
    if (!this.audioUnlocked && pointers.size > 0) {
      this.audio.unlock();
      this.audioUnlocked = true;
    }

    // Phase routing
    if (this.phase === 'building') this.updateBuilding(pointers, dt);
    else if (this.phase === 'baking') this.updateBaking(dt);
    else if (this.phase === 'eating') this.updateEating(pointers, dt);
    else if (this.phase === 'celebrating') this.updateCelebrating(pointers, dt);

    // Topping bounce decay (anywhere)
    for (const t of this.placed) {
      if (t.bounceT > 0) t.bounceT = Math.max(0, t.bounceT - dt * 4);
    }

    // Steam particles
    for (let i = this.steam.length - 1; i >= 0; i--) {
      const s = this.steam[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      s.size += dt * 30;
      if (s.life <= 0) this.steam.splice(i, 1);
    }
  }

  private updateBuilding(pointers: Map<number, import('../types').Pointer>, dt: number) {
    this.bakeBtn.pulse = (this.bakeBtn.pulse + dt) % 1.6;

    // Manage active paint pointer
    if (this.paintPointerId !== null) {
      const p = pointers.get(this.paintPointerId);
      if (!p || !p.down) {
        
        this.paintPointerId = null;
      } else {
        // While dragging, scatter toppings along the path
        const dx = p.x - this.paintLastX;
        const dy = p.y - this.paintLastY;
        this.paintAccum += Math.hypot(dx, dy);
        const stepPx = Math.max(22, this.pizzaR * 0.10);
        while (this.paintAccum >= stepPx) {
          this.paintAccum -= stepPx;
          // Position interpolated between paintLast and current p
          const t = stepPx / Math.max(1, this.paintAccum + stepPx);
          void t;
          this.tryPlaceAt(p.x, p.y);
        }
        this.paintLastX = p.x;
        this.paintLastY = p.y;
      }
    }
    if (this.paintPointerId === null) {
      for (const p of pointers.values()) {
        if (!p.down) continue;
        // Home
        if (isOverHomeButton(p.x, p.y, this.cachedWidth, this.cachedHeight)) {
          this.nav.go('menu');
          return;
        }
        // Bake button?
        if (this.placed.length > 0 && this.isOverBakeBtn(p.x, p.y)) {
          this.startBake();
          return;
        }
        // Tray slot select?
        const slot = this.tray.find(s => {
          const dx = p.x - s.x; const dy = p.y - s.y;
          return dx * dx + dy * dy <= s.r * s.r;
        });
        if (slot) {
          this.selectedType = slot.type;
          if (this.audioUnlocked && !this.spokenForType.has(slot.type)) {
            this.audio.speak(TOPPING_NAMES[slot.type]);
            this.spokenForType.add(slot.type);
          }
          continue;
        }
        // Otherwise, start drag-painting if pointer is on the pizza
        if (this.isOnPizza(p.x, p.y)) {
          
          this.paintPointerId = p.id;
          this.paintLastX = p.x;
          this.paintLastY = p.y;
          this.paintAccum = 0;
          this.tryPlaceAt(p.x, p.y);
        }
        break;
      }
    }
    void dt;
  }

  private updateBaking(dt: number) {
    this.bakeT = Math.min(1, this.bakeT + dt / 3.4);
    // Slide oven in (0..0.25), pizza in (0.25..0.45), bake (0.45..0.78), pizza out (0.78..0.92), oven out (0.92..1)
    this.ovenSlide = this.smoothstep(0, 0.25, this.bakeT) - this.smoothstep(0.92, 1, this.bakeT);
    this.pizzaInOven = this.smoothstep(0.25, 0.45, this.bakeT) - this.smoothstep(0.78, 0.92, this.bakeT);

    // Steam puffs out the top of the oven during the bake window
    if (this.bakeT > 0.45 && this.bakeT < 0.78 && Math.random() < dt * 18) {
      const ovenCx = this.ovenCenterX();
      this.steam.push({
        x: ovenCx + (Math.random() - 0.5) * this.pizzaR * 0.6,
        y: this.pizzaY - this.pizzaR * 0.7,
        vx: (Math.random() - 0.5) * 30,
        vy: -50 - Math.random() * 30,
        life: 1.2 + Math.random() * 0.6,
        size: 6 + Math.random() * 6,
      });
    }

    if (this.bakeT >= 1) {
      this.phase = 'eating';
      this.bakeT = 0;
      this.ovenSlide = 0;
      this.pizzaInOven = 0;
      this.makeSlices();
      if (this.audioUnlocked) {
        this.audio.playFanfare();
        setTimeout(() => this.audio.speak('Pizza is ready!'), 350);
      }
    }
  }

  private updateEating(pointers: Map<number, import('../types').Pointer>, _dt: number) {
    void _dt;
    // Tap → eat the nearest unaten slice that contains the tap
    if (this.paintPointerId !== null) {
      const p = pointers.get(this.paintPointerId);
      if (!p || !p.down) this.paintPointerId = null;
    }
    if (this.paintPointerId === null) {
      for (const p of pointers.values()) {
        if (!p.down) continue;
        if (isOverHomeButton(p.x, p.y, this.cachedWidth, this.cachedHeight)) {
          this.nav.go('menu');
          return;
        }
        const dx = p.x - this.pizzaX;
        const dy = p.y - this.pizzaY;
        const dist = Math.hypot(dx, dy);
        if (dist <= this.pizzaR * 1.05) {
          let ang = Math.atan2(dy, dx);
          if (ang < 0) ang += Math.PI * 2;
          const sliceIdx = Math.floor((ang / (Math.PI * 2)) * this.slices.length) % this.slices.length;
          const slice = this.slices[sliceIdx];
          if (slice && !slice.eaten) {
            this.eatSlice(slice);
          }
        }
        this.paintPointerId = p.id;
        break;
      }
    }

    // Update slice fades + crumb particles
    let allEaten = true;
    for (const s of this.slices) {
      if (!s.eaten) { allEaten = false; continue; }
      s.lift += _dt * 80;
      s.fade = Math.min(1, s.fade + _dt * 1.6);
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const c = s.particles[i];
        c.x += c.vx * _dt;
        c.y += c.vy * _dt;
        c.vy += 600 * _dt;
        c.life -= _dt;
        if (c.life <= 0) s.particles.splice(i, 1);
      }
    }
    if (allEaten && this.slices.length > 0) {
      this.phase = 'celebrating';
      this.celebrateAt = performance.now();
      if (this.audioUnlocked) {
        this.audio.playFanfare();
        setTimeout(() => this.audio.playFanfare(), 700);
        setTimeout(() => this.audio.speak('All gone! Yummy!'), 1300);
      }
      this.spawnConfetti(80);
    }
  }

  private updateCelebrating(pointers: Map<number, import('../types').Pointer>, dt: number) {
    // Confetti rain
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const p = this.confetti[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; p.vx *= Math.pow(0.5, dt); p.rot += p.vrot * dt; p.life -= dt;
      if (p.life <= 0 || p.y > this.cachedHeight + 50) this.confetti.splice(i, 1);
    }
    if (this.confetti.length < 80 && Math.random() < 0.7) this.spawnConfetti(4);

    const elapsed = (performance.now() - this.celebrateAt) / 1000;
    if (elapsed > 2.0 && pointers.size > 0) {
      this.resetForAnotherPizza();
    }
  }

  private resetForAnotherPizza() {
    this.placed = [];
    this.slices = [];
    this.phase = 'building';
    this.bakeT = 0;
    this.confetti.length = 0;
    
    this.paintPointerId = null;
  }

  // ============ Topping placement ============

  private isOnPizza(px: number, py: number): boolean {
    const dx = px - this.pizzaX;
    const dy = py - this.pizzaY;
    return dx * dx + dy * dy <= (this.pizzaR * 0.95) * (this.pizzaR * 0.95);
  }

  private tryPlaceAt(px: number, py: number) {
    if (!this.isOnPizza(px, py)) return;
    if (this.placed.length > 80) return; // safety cap
    const rx = (px - this.pizzaX) / this.pizzaR;
    const ry = (py - this.pizzaY) / this.pizzaR;
    this.placed.push({
      type: this.selectedType,
      rx,
      ry,
      rot: Math.random() * Math.PI * 2,
      scale: 0.85 + Math.random() * 0.30,
      bounceT: 1,
    });
    if (this.audioUnlocked) this.audio.playClunk();
    if ('vibrate' in navigator) navigator.vibrate?.(4);
  }

  // ============ Bake button ============

  private isOverBakeBtn(px: number, py: number): boolean {
    const b = this.bakeBtn;
    return px >= b.x - b.w / 2 && px <= b.x + b.w / 2 && py >= b.y - b.h / 2 && py <= b.y + b.h / 2;
  }

  private startBake() {
    this.phase = 'baking';
    this.bakeT = 0;
    
    this.paintPointerId = null;
    if (this.audioUnlocked) {
      this.audio.playSparkle();
      setTimeout(() => this.audio.speak('Into the oven!'), 200);
    }
  }

  private ovenCenterX(): number {
    const ovenW = this.pizzaR * 2.4;
    const onScreenX = this.pizzaX;
    const offScreenX = this.cachedWidth + ovenW;
    return offScreenX + (onScreenX - offScreenX) * this.ovenSlide;
  }

  // ============ Slicing & eating ============

  private makeSlices() {
    const n = 8;
    this.slices = [];
    for (let i = 0; i < n; i++) {
      this.slices.push({
        eaten: false,
        lift: 0,
        fade: 0,
        angle: (i + 0.5) / n * Math.PI * 2,
        particles: [],
      });
    }
  }

  private eatSlice(s: Slice) {
    s.eaten = true;
    s.lift = 0;
    s.fade = 0;
    if (this.audioUnlocked) {
      this.audio.playClunk();
      const word = MUNCH_WORDS[Math.floor(Math.random() * MUNCH_WORDS.length)];
      setTimeout(() => this.audio.speak(word), 100);
    }
    if ('vibrate' in navigator) navigator.vibrate?.(15);
    // Crumb particles
    const cx = this.pizzaX + Math.cos(s.angle) * this.pizzaR * 0.5;
    const cy = this.pizzaY + Math.sin(s.angle) * this.pizzaR * 0.5;
    for (let i = 0; i < 12; i++) {
      s.particles.push({
        x: cx + (Math.random() - 0.5) * this.pizzaR * 0.4,
        y: cy + (Math.random() - 0.5) * this.pizzaR * 0.2,
        vx: (Math.random() - 0.5) * 200,
        vy: -120 - Math.random() * 80,
        life: 0.6 + Math.random() * 0.5,
        size: 3 + Math.random() * 3,
        color: ['#c87a30', '#a8281a', '#fdd96a', '#3da53a'][Math.floor(Math.random() * 4)],
      });
    }
  }

  private spawnConfetti(n: number) {
    const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#a55eea', '#ff9ff3'];
    for (let i = 0; i < n; i++) {
      this.confetti.push({
        x: Math.random() * this.cachedWidth,
        y: -20 - Math.random() * 80,
        vx: (Math.random() - 0.5) * 80,
        vy: 60 + Math.random() * 80,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 8,
        life: 5 + Math.random() * 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 5 + Math.random() * 4,
      });
    }
  }

  // ============ Render ============

  render({ ctx, width, height }: FrameContext) {
    // Cozy kitchen background
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#fff1d3');
    bg.addColorStop(1, '#ffd5a5');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    // Wood-grain table lines (subtle)
    ctx.fillStyle = 'rgba(170,100,40,0.06)';
    for (let y = 0; y < height; y += 22) ctx.fillRect(0, y, width, 1);

    // Order of draw is phase-aware so the oven can be on top of the pizza
    // when the pizza is "inside" it.
    if (this.phase === 'baking') {
      this.drawPizzaInBake(ctx);
      this.drawOven(ctx);
    } else if (this.phase === 'eating') {
      this.drawPizzaSliced(ctx);
    } else if (this.phase === 'celebrating') {
      this.drawPizzaSliced(ctx);
    } else {
      this.drawPizzaWhole(ctx);
    }

    // Steam puffs
    for (const s of this.steam) {
      const a = Math.min(1, s.life * 1.5);
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Tray + bake button only during building
    if (this.phase === 'building') {
      this.drawTray(ctx);
      if (this.placed.length > 0) this.drawBakeBtn(ctx);
      this.drawHint(ctx);
    }
    if (this.phase === 'eating') {
      this.drawEatHint(ctx, width, height);
    }

    drawHomeButton(ctx, width, height);

    if (this.phase === 'celebrating') this.drawCompleteOverlay(ctx, width, height);
  }

  private drawHint(ctx: CanvasRenderingContext2D) {
    if (this.placed.length > 0) return;
    ctx.fillStyle = 'rgba(58,40,24,0.6)';
    const sz = Math.min(this.cachedWidth, this.cachedHeight) * 0.030;
    ctx.font = `${Math.round(sz)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Pick a topping  •  tap or drag on the pizza', this.cachedWidth / 2, this.pizzaY - this.pizzaR - sz);
  }

  private drawEatHint(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const left = this.slices.filter(s => !s.eaten).length;
    if (left === 0) return;
    ctx.fillStyle = 'rgba(58,40,24,0.6)';
    const sz = Math.min(w, h) * 0.030;
    ctx.font = `${Math.round(sz)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Tap a slice to eat!', w / 2, this.pizzaY - this.pizzaR - sz * 1.5);
  }

  // ============ Pizza drawing ============

  private drawPizzaWhole(ctx: CanvasRenderingContext2D) {
    this.drawPizzaBase(ctx, this.pizzaX, this.pizzaY, this.pizzaR, false);
    // Toppings
    for (const t of this.placed) this.drawPlacedTopping(ctx, t, this.pizzaX, this.pizzaY, this.pizzaR);
  }

  private drawPizzaInBake(ctx: CanvasRenderingContext2D) {
    // Pizza moves into the oven and back. Browning ramps up between 0.45..0.78.
    const ovenX = this.ovenCenterX();
    const px = this.pizzaX + (ovenX - this.pizzaX) * this.pizzaInOven;
    const py = this.pizzaY;
    const t = this.bakeT;
    const browning = this.smoothstep(0.45, 0.95, t);
    this.drawPizzaBase(ctx, px, py, this.pizzaR, browning > 0.05, browning);
    for (const top of this.placed) {
      this.drawPlacedTopping(ctx, top, px, py, this.pizzaR, browning);
    }
  }

  private drawPizzaSliced(ctx: CanvasRenderingContext2D) {
    // Plate first
    this.drawPlate(ctx, this.pizzaX, this.pizzaY, this.pizzaR);

    const r = this.pizzaR;
    const n = this.slices.length;
    for (let i = 0; i < n; i++) {
      const slice = this.slices[i];
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const cAng = (a0 + a1) / 2;
      ctx.save();
      // Lifted slices float up while fading.
      const offsetY = -slice.lift;
      const alpha = 1 - slice.fade;
      ctx.globalAlpha = alpha;
      ctx.translate(this.pizzaX + Math.cos(cAng) * slice.lift * 0.4, this.pizzaY + offsetY);
      // Clip to slice wedge so toppings get cut along slice lines.
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a0, a1);
      ctx.closePath();
      ctx.clip();
      this.drawPizzaBase(ctx, 0, 0, r, true, 1);
      for (const top of this.placed) {
        this.drawPlacedTopping(ctx, top, 0, 0, r, 1);
      }
      ctx.restore();
    }
    // Slice separator lines on top of plate
    if (this.phase === 'eating' || this.phase === 'celebrating') {
      ctx.strokeStyle = 'rgba(122,72,30,0.6)';
      ctx.lineWidth = 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(this.pizzaX, this.pizzaY);
        ctx.lineTo(this.pizzaX + Math.cos(a) * r * 0.96, this.pizzaY + Math.sin(a) * r * 0.96);
        ctx.stroke();
      }
    }
    // Crumb particles for eaten slices
    ctx.globalAlpha = 1;
    for (const slice of this.slices) {
      for (const p of slice.particles) {
        ctx.globalAlpha = Math.min(1, p.life * 1.5);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPlate(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    ctx.fillStyle = '#f3edd8';
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.04, r * 1.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d4cba2';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  private drawPizzaBase(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, baked: boolean, browning = 0) {
    // Plate behind the whole pizza when not in baking phase
    if (this.phase !== 'baking') this.drawPlate(ctx, cx, cy, r);
    // Crust — outer ring, more golden then darker as baking progresses
    const crustOuter = baked ? this.lerpColor('#c87a30', '#7a4010', browning) : '#c87a30';
    const crustInner = baked ? this.lerpColor('#9a5818', '#5a3008', browning) : '#9a5818';
    const crustGrad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.55, cx, cy, r);
    crustGrad.addColorStop(0, crustOuter);
    crustGrad.addColorStop(1, crustInner);
    ctx.fillStyle = crustGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // Crust bumps along the rim
    ctx.strokeStyle = baked ? this.lerpColor('#9a5818', '#3a1a08', browning) : '#9a5818';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
    ctx.stroke();
    // Sauce + cheese (inner disk)
    const cheese = baked ? this.lerpColor('#fdd96a', '#e6a832', browning) : '#fdd96a';
    ctx.fillStyle = cheese;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
    ctx.fill();
    // Sauce hint underneath
    ctx.fillStyle = baked ? `rgba(170, 50, 30, ${0.55 + browning * 0.2})` : 'rgba(228, 86, 56, 0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
    ctx.fill();
    // Melt blobs: lighter when raw, more golden/charred when baked
    const blobLight = baked ? this.lerpColor('rgba(255,235,140,0.85)', 'rgba(220,170,60,0.95)', browning) : 'rgba(255,235,140,0.85)';
    ctx.fillStyle = blobLight;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + i * 0.37;
      const dist = (0.25 + (i % 4) * 0.16) * r;
      const bx = cx + Math.cos(a) * dist;
      const by = cy + Math.sin(a) * dist;
      ctx.beginPath();
      ctx.ellipse(bx, by, r * 0.09, r * 0.06, i, 0, Math.PI * 2);
      ctx.fill();
    }
    // Bubbly char spots when baked
    if (baked && browning > 0.6) {
      ctx.fillStyle = `rgba(60,30,10,${(browning - 0.5) * 0.55})`;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + i * 1.7;
        const dist = (0.2 + (i % 5) * 0.13) * r;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawPlacedTopping(ctx: CanvasRenderingContext2D, t: PlacedTopping, cx: number, cy: number, r: number, browning = 0) {
    const px = cx + t.rx * r;
    const py = cy + t.ry * r;
    // Bounce: scale pop on placement
    const pop = t.bounceT > 0 ? 1 + Math.sin(t.bounceT * Math.PI) * 0.20 : 1;
    this.drawTopping(ctx, px, py, t.type, t.scale * pop * (r / 280) * 1.6, t.rot, browning);
  }

  // ============ Topping art (richer than v1) ============

  private drawTopping(ctx: CanvasRenderingContext2D, x: number, y: number, type: ToppingType, sc: number, rot: number, browning = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    if (type === 'pepperoni') this.artPepperoni(ctx, browning);
    else if (type === 'mushroom') this.artMushroom(ctx, browning);
    else if (type === 'olive') this.artOlive(ctx);
    else if (type === 'pepper') this.artPepper(ctx, browning);
    else if (type === 'cheese') this.artCheese(ctx, browning);
    else if (type === 'tomato') this.artTomato(ctx, browning);
    ctx.restore();
  }

  private artPepperoni(ctx: CanvasRenderingContext2D, browning: number) {
    // Base disc with curl rim
    const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 13);
    g.addColorStop(0, this.lerpColor('#f06848', '#a8351a', browning));
    g.addColorStop(0.7, this.lerpColor('#cc3a22', '#7a1808', browning));
    g.addColorStop(1, this.lerpColor('#7a1810', '#3a0a08', browning));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.lerpColor('#5a1008', '#2a0a08', browning);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Slight curl (darker arc on one side suggests the slice has curled)
    ctx.fillStyle = `rgba(60, 10, 5, ${0.35 + browning * 0.3})`;
    ctx.beginPath();
    ctx.arc(0, 0, 12, Math.PI * 0.85, Math.PI * 1.55);
    ctx.arc(0, 0, 9.5, Math.PI * 1.55, Math.PI * 0.85, true);
    ctx.closePath();
    ctx.fill();
    // Fat flecks
    ctx.fillStyle = '#f3d2a0';
    for (const [px, py, rd] of [[-3, -2, 1.6], [4, 1, 1.4], [-1, 4, 1.2], [3, -4, 1.0]] as const) {
      ctx.beginPath();
      ctx.arc(px, py, rd, 0, Math.PI * 2);
      ctx.fill();
    }
    // Top highlight
    ctx.fillStyle = 'rgba(255,200,170,0.35)';
    ctx.beginPath();
    ctx.ellipse(-4, -5, 4, 1.4, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private artMushroom(ctx: CanvasRenderingContext2D, browning: number) {
    // Side view: dome cap + cream stem
    // Cap
    const capGrad = ctx.createLinearGradient(0, -10, 0, 0);
    capGrad.addColorStop(0, this.lerpColor('#b88862', '#7a4f10', browning));
    capGrad.addColorStop(1, this.lerpColor('#7a5028', '#3a1808', browning));
    ctx.fillStyle = capGrad;
    ctx.beginPath();
    ctx.arc(0, -1, 11, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = this.lerpColor('#3a2010', '#1a0808', browning);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Cap dent shading
    ctx.strokeStyle = 'rgba(40,20,8,0.4)';
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 4, -10);
      ctx.lineTo(i * 4, -2);
      ctx.stroke();
    }
    // Stem
    ctx.fillStyle = this.lerpColor('#f3e2c0', '#c8a868', browning);
    ctx.beginPath();
    ctx.moveTo(-4.5, -1);
    ctx.lineTo(-3.5, 5);
    ctx.lineTo(3.5, 5);
    ctx.lineTo(4.5, -1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = this.lerpColor('#9a8868', '#5a4828', browning);
    ctx.lineWidth = 1;
    ctx.stroke();
    // Gill hint under cap
    ctx.strokeStyle = 'rgba(120,90,50,0.55)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-10, -1);
    ctx.lineTo(10, -1);
    ctx.stroke();
    // Highlight on cap
    ctx.fillStyle = 'rgba(255,220,180,0.45)';
    ctx.beginPath();
    ctx.ellipse(-3, -7, 4, 2, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  private artOlive(ctx: CanvasRenderingContext2D) {
    // Glossy black ring
    const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 9);
    g.addColorStop(0, '#3a3a3a');
    g.addColorStop(0.6, '#1a1a1a');
    g.addColorStop(1, '#080808');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Inner hole + shadow
    const hg = ctx.createRadialGradient(-1, -1, 0, 0, 0, 4);
    hg.addColorStop(0, '#7a4818');
    hg.addColorStop(1, '#1a0a04');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
    ctx.fill();
    // Specular highlight
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(-3, -4, 2, 1, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private artPepper(ctx: CanvasRenderingContext2D, browning: number) {
    // Bumpy green pepper ring (slight bell pepper irregularity)
    const baseColor = this.lerpColor('#3da53a', '#1f5a1d', browning);
    const darkColor = this.lerpColor('#1f5f1d', '#0a2808', browning);
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    // Outer wobble
    const outerR = 11;
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const wob = (i % 3 === 0 ? 1.0 : 0.85);
      const px = Math.cos(a) * outerR * wob;
      const py = Math.sin(a) * outerR * wob;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // Inner ring (cavity)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 4.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = darkColor;
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
    ctx.fill();
    // Outline
    ctx.strokeStyle = darkColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.stroke();
    // Highlight
    ctx.fillStyle = 'rgba(180, 240, 180, 0.5)';
    ctx.beginPath();
    ctx.ellipse(-5, -5, 3, 1.4, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  private artCheese(ctx: CanvasRenderingContext2D, browning: number) {
    // Soft mozzarella blob
    const g = ctx.createRadialGradient(-2, -3, 1, 0, 0, 10);
    g.addColorStop(0, '#fffaee');
    g.addColorStop(1, this.lerpColor('#f0e0c0', '#c89a4a', browning));
    ctx.fillStyle = g;
    ctx.beginPath();
    // Irregular blob shape
    ctx.moveTo(-9, -3);
    ctx.bezierCurveTo(-11, -8, -2, -10, 4, -8);
    ctx.bezierCurveTo(11, -6, 11, 5, 5, 8);
    ctx.bezierCurveTo(-3, 11, -10, 6, -9, -3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = this.lerpColor('rgba(180,150,100,0.6)', 'rgba(120,80,40,0.7)', browning);
    ctx.lineWidth = 1;
    ctx.stroke();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.ellipse(-3, -5, 4, 2, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  private artTomato(ctx: CanvasRenderingContext2D, browning: number) {
    // Red disc with seed cluster center
    const baseColor = this.lerpColor('#e8553a', '#a8331a', browning);
    const rimColor = this.lerpColor('#a8281a', '#5a1008', browning);
    const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, 11);
    g.addColorStop(0, this.lerpColor('#ff8060', '#c84628', browning));
    g.addColorStop(1, baseColor);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rimColor;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Inner pulp boundary
    ctx.strokeStyle = `rgba(180, 60, 40, 0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
    ctx.stroke();
    // Seeds
    ctx.fillStyle = '#fff7d0';
    for (const [px, py] of [[-2, -1], [2, -2], [-1, 2], [3, 2]] as const) {
      ctx.beginPath();
      ctx.ellipse(px, py, 1.4, 0.9, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(-4, -4, 3, 1.2, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ============ Tray + Bake button + Oven ============

  private drawTray(ctx: CanvasRenderingContext2D) {
    // Tray panel
    const minR = this.tray.length > 0 ? this.tray[0].r : 30;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of this.tray) {
      x0 = Math.min(x0, s.x - s.r);
      x1 = Math.max(x1, s.x + s.r);
      y0 = Math.min(y0, s.y - s.r);
      y1 = Math.max(y1, s.y + s.r);
    }
    const padding = minR * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    roundRect(ctx, x0 - padding, y0 - padding, (x1 - x0) + padding * 2, (y1 - y0) + padding * 2, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(170,85,16,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (const s of this.tray) {
      const isSelected = s.type === this.selectedType;
      // Slot
      ctx.fillStyle = isSelected ? '#fff8d8' : '#f3edd8';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#f0a020' : '#c8b888';
      ctx.lineWidth = isSelected ? 5 : 2.5;
      ctx.stroke();
      // Topping inside slot
      this.drawTopping(ctx, s.x, s.y, s.type, 1.7, 0, 0);
      // Selected pulse
      if (isSelected) {
        const t = (performance.now() / 800) % 1;
        ctx.strokeStyle = `rgba(240,160,32,${(1 - t) * 0.7})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r + t * 14, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawBakeBtn(ctx: CanvasRenderingContext2D) {
    const b = this.bakeBtn;
    const pulse = 1 + Math.sin(b.pulse / 1.6 * Math.PI * 2) * 0.04;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(pulse, pulse);
    const grad = ctx.createLinearGradient(0, -b.h / 2, 0, b.h / 2);
    grad.addColorStop(0, '#ffb046');
    grad.addColorStop(1, '#cc6510');
    ctx.fillStyle = grad;
    roundRect(ctx, -b.w / 2, -b.h / 2, b.w, b.h, b.h * 0.35);
    ctx.fill();
    ctx.strokeStyle = '#7a3008';
    ctx.lineWidth = 4;
    ctx.stroke();
    // Label
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#7a3008';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.font = `900 ${Math.round(b.h * 0.55)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText('BAKE!', 0, 2);
    ctx.fillText('BAKE!', 0, 2);
    ctx.restore();
  }

  private drawOven(ctx: CanvasRenderingContext2D) {
    const ovenW = this.pizzaR * 2.6;
    const ovenH = this.pizzaR * 2.6;
    const cx = this.ovenCenterX();
    const cy = this.pizzaY;
    ctx.save();
    ctx.translate(cx, cy);
    // Oven body (dark brown box)
    const grad = ctx.createLinearGradient(-ovenW / 2, -ovenH / 2, ovenW / 2, ovenH / 2);
    grad.addColorStop(0, '#5a3818');
    grad.addColorStop(1, '#2a1408');
    ctx.fillStyle = grad;
    roundRect(ctx, -ovenW / 2, -ovenH / 2, ovenW, ovenH, 16);
    ctx.fill();
    ctx.strokeStyle = '#1a0a04';
    ctx.lineWidth = 4;
    ctx.stroke();
    // Top vent
    ctx.fillStyle = '#1a0a04';
    ctx.fillRect(-ovenW * 0.30, -ovenH / 2 - 8, ovenW * 0.6, 8);
    // Door window — circular
    const winR = ovenW * 0.42;
    // Window glow when baking
    const glowing = this.bakeT > 0.40 && this.bakeT < 0.85;
    const windowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, winR);
    if (glowing) {
      windowGrad.addColorStop(0, '#ffe680');
      windowGrad.addColorStop(0.6, '#f0863a');
      windowGrad.addColorStop(1, '#7a2a08');
    } else {
      windowGrad.addColorStop(0, '#3a2010');
      windowGrad.addColorStop(1, '#1a0a04');
    }
    ctx.fillStyle = windowGrad;
    ctx.beginPath();
    ctx.arc(0, 0, winR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a0a04';
    ctx.lineWidth = 5;
    ctx.stroke();
    // Window inner shadow
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, winR - 4, 0, Math.PI * 2);
    ctx.stroke();
    // Handle
    ctx.fillStyle = '#a86a3a';
    roundRect(ctx, -ovenW * 0.34, ovenH * 0.28, ovenW * 0.68, 10, 5);
    ctx.fill();
    ctx.strokeStyle = '#5a2a08';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private drawCompleteOverlay(ctx: CanvasRenderingContext2D, width: number, height: number) {
    for (const p of this.confetti) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, p.life * 0.6);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(0, 0, width, height);
    const t = (performance.now() - this.celebrateAt) / 1000;
    const bob = Math.sin(t * 3.2) * 6;
    const titleSize = Math.min(width, height) * 0.13;
    ctx.font = `900 ${Math.round(titleSize)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(8, titleSize * 0.10);
    ctx.strokeStyle = '#fff';
    ctx.strokeText('ALL GONE!', width / 2, height * 0.40 + bob);
    const titleGrad = ctx.createLinearGradient(0, height * 0.34, 0, height * 0.48);
    titleGrad.addColorStop(0, '#ff8c42');
    titleGrad.addColorStop(1, '#aa3a08');
    ctx.fillStyle = titleGrad;
    ctx.fillText('ALL GONE!', width / 2, height * 0.40 + bob);
    if (t > 2.0) {
      const pulse = 0.65 + Math.sin(t * 4) * 0.35;
      ctx.globalAlpha = pulse;
      const hintSize = Math.min(width, height) * 0.045;
      ctx.font = `bold ${Math.round(hintSize)}px system-ui, sans-serif`;
      ctx.fillStyle = '#3a2818';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.strokeText('Tap to make another', width / 2, height * 0.62);
      ctx.fillText('Tap to make another', width / 2, height * 0.62);
      ctx.globalAlpha = 1;
    }
  }

  // ============ utils ============

  private smoothstep(a: number, b: number, t: number): number {
    const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return x * x * (3 - 2 * x);
  }

  private lerpColor(a: string, b: string, t: number): string {
    const ax = parseColor(a);
    const bx = parseColor(b);
    if (!ax || !bx) return a;
    const k = Math.max(0, Math.min(1, t));
    const out = ax.map((v, i) => Math.round(v + (bx[i] - v) * k));
    if (ax.length === 4 || bx.length === 4) {
      return `rgba(${out[0]},${out[1]},${out[2]},${(out[3] ?? 255) / 255})`;
    }
    return `rgb(${out[0]},${out[1]},${out[2]})`;
  }
}

function parseColor(c: string): number[] | null {
  if (c.startsWith('#')) {
    if (c.length === 7) {
      return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    }
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(c);
  if (rgb) {
    const r = parseInt(rgb[1], 10);
    const g = parseInt(rgb[2], 10);
    const b = parseInt(rgb[3], 10);
    const a = rgb[4] !== undefined ? Math.round(parseFloat(rgb[4]) * 255) : undefined;
    return a !== undefined ? [r, g, b, a] : [r, g, b];
  }
  return null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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
