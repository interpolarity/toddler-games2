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
    this.drawKitchen(ctx, width, height);

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
      // Filled content clipped to the wedge.
      ctx.save();
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
      // Boundary lines drawn inside the slice's alpha+translate so they fade
      // and lift with the slice itself (fixes lines persisting after eating).
      ctx.strokeStyle = 'rgba(74,36,16,0.55)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a0) * r * 0.96, Math.sin(a0) * r * 0.96);
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a1) * r * 0.96, Math.sin(a1) * r * 0.96);
      ctx.stroke();
      ctx.restore();
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
    // Flat plate with thick dark outline; slight wobble.
    ctx.save();
    ctx.translate(cx, cy + r * 0.04);
    ctx.fillStyle = '#fff6e0';
    blob(ctx, 0, 0, r * 1.14, 0.025, 3);
    ctx.fill();
    ctx.strokeStyle = '#7a5a30';
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Inner rim line so the plate reads as a rim.
    ctx.strokeStyle = '#caa770';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.02, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawPizzaBase(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, baked: boolean, browning = 0) {
    if (this.phase !== 'baking') this.drawPlate(ctx, cx, cy, r);

    const stroke = '#4a2410';
    const crust = baked ? this.lerpColor('#e89a3a', '#7a4010', browning) : '#e89a3a';
    const cheese = baked ? this.lerpColor('#fce088', '#dba038', browning) : '#fce088';
    const sauce = baked ? this.lerpColor('#e64d2a', '#a02410', browning) : '#e64d2a';

    ctx.save();
    ctx.translate(cx, cy);

    // Crust — flat colored disc with slight wobbly edge.
    ctx.fillStyle = crust;
    blob(ctx, 0, 0, r, 0.015, 4);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Sauce — solid red, slightly inset, slightly wobbly.
    ctx.fillStyle = sauce;
    blob(ctx, 0, 0, r * 0.84, 0.020, 6);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Cheese — flat yellow, even more inset.
    ctx.fillStyle = cheese;
    blob(ctx, 0, 0, r * 0.78, 0.030, 8);
    ctx.fill();

    // A few flat cream "melt patches" rather than gradient shading.
    ctx.fillStyle = baked ? this.lerpColor('#fff0b0', '#e0a850', browning) : '#fff0b0';
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + i * 0.7;
      const dist = (0.28 + (i % 2) * 0.22) * r;
      const bx = Math.cos(a) * dist;
      const by = Math.sin(a) * dist;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(i * 0.7);
      blob(ctx, 0, 0, r * 0.10, 0.18, i + 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Char spots once well baked.
    if (baked && browning > 0.55) {
      ctx.fillStyle = `rgba(60,30,10,${(browning - 0.5) * 0.7})`;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + i * 1.7;
        const dist = (0.22 + (i % 4) * 0.14) * r;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * dist, Math.sin(a) * dist, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawPlacedTopping(ctx: CanvasRenderingContext2D, t: PlacedTopping, cx: number, cy: number, r: number, browning = 0) {
    const px = cx + t.rx * r;
    const py = cy + t.ry * r;
    // Bounce: scale pop on placement
    const pop = t.bounceT > 0 ? 1 + Math.sin(t.bounceT * Math.PI) * 0.20 : 1;
    // Idle breathe — tiny phase-offset scale wobble so the pizza feels alive.
    // Phase is seeded from rx/ry so each topping breathes a bit differently.
    const phase = (t.rx * 7.3 + t.ry * 5.1);
    const breathe = 1 + Math.sin(performance.now() / 600 + phase) * 0.025;
    this.drawTopping(ctx, px, py, t.type, t.scale * pop * breathe * (r / 280) * 1.6, t.rot, browning);
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

  // Sago-Mini-style art rules:
  //  - flat fills only (no radial gradients)
  //  - thick consistent dark-brown outlines
  //  - slightly organic (asymmetric, wobbly) edges
  //  - ONE solid white highlight shape as the gloss accent
  //  - small darker accents (specks, seeds) instead of shading
  private artPepperoni(ctx: CanvasRenderingContext2D, browning: number) {
    const fill = this.lerpColor('#ec4a3a', '#a02818', browning);
    const stroke = this.lerpColor('#4a1a08', '#2a0a04', browning);
    ctx.fillStyle = fill;
    ctx.beginPath();
    // Slightly wobbly disc rather than perfect circle
    blob(ctx, 0, 0, 11.5, 0.10, 7);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Specks (small darker ovals)
    ctx.fillStyle = this.lerpColor('#7a1808', '#3a0a04', browning);
    for (const [px, py, rx, ry, rot] of [
      [-3, -2, 1.8, 1.3, 0.3],
      [3.5, 1.5, 1.6, 1.1, -0.4],
      [-1, 4, 1.4, 1.0, 0.6],
      [3, -4, 1.2, 0.9, 0.2],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2);
      ctx.fill();
    }
    // Single solid-white highlight
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(-4.5, -5, 3.4, 1.2, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private artMushroom(ctx: CanvasRenderingContext2D, browning: number) {
    const cap = this.lerpColor('#d6a777', '#8a5430', browning);
    const stem = this.lerpColor('#fff0d4', '#d4ad6c', browning);
    const stroke = this.lerpColor('#3a2010', '#1a0808', browning);
    // Stem first so cap overlaps
    ctx.fillStyle = stem;
    ctx.beginPath();
    ctx.moveTo(-4.5, 0);
    ctx.lineTo(-3.5, 5.5);
    ctx.quadraticCurveTo(0, 6.5, 3.5, 5.5);
    ctx.lineTo(4.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Cap — dome with slight wobble
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.moveTo(-11, 0);
    ctx.quadraticCurveTo(-11.5, -10, 0, -11);
    ctx.quadraticCurveTo(11.5, -10, 11, 0);
    ctx.lineTo(7, 0);
    ctx.quadraticCurveTo(0, 1.5, -7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Two cream spots on the cap (Sago likes spots)
    ctx.fillStyle = stem;
    ctx.beginPath();
    ctx.ellipse(-3, -6, 2.2, 1.6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(4, -4, 1.6, 1.2, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(-5, -8, 2.4, 0.9, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  private artOlive(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#2a2418';
    ctx.beginPath();
    blob(ctx, 0, 0, 9, 0.06, 8);
    ctx.fill();
    ctx.strokeStyle = '#1a0a04';
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Inner hole (warm brown so it reads as the pit)
    ctx.fillStyle = '#7a4818';
    ctx.beginPath();
    ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a1808';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    // Single highlight
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(-3, -4, 2.2, 0.9, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private artPepper(ctx: CanvasRenderingContext2D, browning: number) {
    const fill = this.lerpColor('#5fb84a', '#347a25', browning);
    const stroke = this.lerpColor('#1f5f1d', '#0a3008', browning);
    // Outer wobbly ring
    ctx.fillStyle = fill;
    ctx.beginPath();
    blob(ctx, 0, 0, 11.5, 0.10, 9);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Cavity — flat solid, outlined
    ctx.fillStyle = this.lerpColor('#a8d68a', '#5a8a4a', browning);
    ctx.beginPath();
    ctx.arc(0, 0, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(-5, -5, 2.6, 1.1, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  private artCheese(ctx: CanvasRenderingContext2D, browning: number) {
    const fill = this.lerpColor('#fff5d8', '#e8c060', browning);
    const stroke = this.lerpColor('#6a4a18', '#3a2008', browning);
    // Soft blob (organic)
    ctx.fillStyle = fill;
    ctx.beginPath();
    blob(ctx, 0, 0, 9.5, 0.12, 8);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Small crease accent (mozzarella twist)
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-3, 1);
    ctx.quadraticCurveTo(0, 3, 4, 0.5);
    ctx.stroke();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(-3, -5, 3.2, 1.2, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  private artTomato(ctx: CanvasRenderingContext2D, browning: number) {
    const fill = this.lerpColor('#e84030', '#a82818', browning);
    const stroke = this.lerpColor('#5a1408', '#2a0a04', browning);
    ctx.fillStyle = fill;
    ctx.beginPath();
    blob(ctx, 0, 0, 10.5, 0.06, 9);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Seed cluster — flat cream center with a few oval seeds
    ctx.fillStyle = this.lerpColor('#fff5c8', '#d8a868', browning);
    ctx.beginPath();
    ctx.ellipse(0, 0.5, 5.2, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Seeds
    ctx.fillStyle = stroke;
    for (const [px, py, rx, ry, rot] of [
      [-2, -1, 0.9, 0.5, 0.2],
      [2, -1.5, 0.9, 0.5, -0.3],
      [-1, 1.5, 0.9, 0.5, 0.5],
      [2.5, 1.5, 0.9, 0.5, -0.1],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2);
      ctx.fill();
    }
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(-5, -5, 2.6, 1.0, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ============ Tray + Bake button + Oven ============

  private drawTray(ctx: CanvasRenderingContext2D) {
    const stroke = '#4a2410';
    const minR = this.tray.length > 0 ? this.tray[0].r : 30;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of this.tray) {
      x0 = Math.min(x0, s.x - s.r);
      x1 = Math.max(x1, s.x + s.r);
      y0 = Math.min(y0, s.y - s.r);
      y1 = Math.max(y1, s.y + s.r);
    }
    const padding = minR * 0.55;
    ctx.fillStyle = '#fff6e0';
    roundRect(ctx, x0 - padding, y0 - padding, (x1 - x0) + padding * 2, (y1 - y0) + padding * 2, 18);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    for (const s of this.tray) {
      const isSelected = s.type === this.selectedType;
      // Slot dish — flat fill, thick outline.
      ctx.fillStyle = isSelected ? '#ffeab0' : '#f3e8c8';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#d68028' : stroke;
      ctx.lineWidth = isSelected ? 4.5 : 3;
      ctx.stroke();
      // Topping inside slot
      this.drawTopping(ctx, s.x, s.y, s.type, 1.7, 0, 0);
      // Selected pulse ring
      if (isSelected) {
        const t = (performance.now() / 800) % 1;
        ctx.strokeStyle = `rgba(214,128,40,${(1 - t) * 0.75})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r + t * 14, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawBakeBtn(ctx: CanvasRenderingContext2D) {
    const b = this.bakeBtn;
    const pulse = 1 + Math.sin(b.pulse / 1.6 * Math.PI * 2) * 0.05;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(pulse, pulse);
    // Flat orange pill with thick outline
    ctx.fillStyle = '#f49432';
    roundRect(ctx, -b.w / 2, -b.h / 2, b.w, b.h, b.h * 0.5);
    ctx.fill();
    ctx.strokeStyle = '#4a2410';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Subtle highlight stripe (single solid white shape — Sago-style)
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    roundRect(ctx, -b.w / 2 + b.h * 0.20, -b.h / 2 + b.h * 0.10, b.w - b.h * 0.40, b.h * 0.18, b.h * 0.10);
    ctx.fill();
    // Label
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#4a2410';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.font = `900 ${Math.round(b.h * 0.55)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText('BAKE!', 0, 2);
    ctx.fillText('BAKE!', 0, 2);
    ctx.restore();
  }

  private drawKitchen(ctx: CanvasRenderingContext2D, width: number, height: number) {
    // Counter line — splits the scene into brick wall (back) and wood counter (front).
    const counterY = this.cachedHeight * 0.78;

    // --- Brick wall (back) ---
    // Warm cream wash so the room feels lit.
    const wall = ctx.createLinearGradient(0, 0, 0, counterY);
    wall.addColorStop(0, '#ffe4bf');
    wall.addColorStop(1, '#f6c890');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, width, counterY);

    // Brick pattern — staggered, two shades, with mortar gaps.
    const bw = Math.min(width, height) * 0.10;
    const bh = bw * 0.45;
    const mortar = '#e3b07a';
    ctx.fillStyle = mortar;
    ctx.fillRect(0, 0, width, counterY);
    let row = 0;
    for (let y = -bh; y < counterY; y += bh + 2) {
      const offset = (row % 2) * (bw / 2);
      for (let x = -bw + offset; x < width + bw; x += bw + 2) {
        const shade = ((row * 31 + Math.round(x / bw)) % 3);
        ctx.fillStyle = shade === 0 ? '#e7b07a' : shade === 1 ? '#d99a64' : '#c0875a';
        roundRect(ctx, x, y, bw, bh, 3);
        ctx.fill();
      }
      row++;
    }
    // Soft top-light vignette to keep eye on the action.
    const vignette = ctx.createRadialGradient(width * 0.5, counterY * 0.6, 0, width * 0.5, counterY * 0.6, Math.max(width, counterY) * 0.85);
    vignette.addColorStop(0, 'rgba(255,255,210,0.25)');
    vignette.addColorStop(1, 'rgba(80,40,10,0.18)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, counterY);

    // --- Wood counter (front) ---
    const woodTop = counterY;
    const woodBot = height;
    const counterGrad = ctx.createLinearGradient(0, woodTop, 0, woodBot);
    counterGrad.addColorStop(0, '#c08653');
    counterGrad.addColorStop(0.4, '#a3683a');
    counterGrad.addColorStop(1, '#7a4520');
    ctx.fillStyle = counterGrad;
    ctx.fillRect(0, woodTop, width, woodBot - woodTop);
    // Thick lip outline so the counter reads as an edge.
    ctx.fillStyle = '#3a2008';
    ctx.fillRect(0, woodTop - 4, width, 4);
    ctx.fillStyle = '#5a3a18';
    ctx.fillRect(0, woodTop - 8, width, 4);
    // Grain lines — irregular widths/positions so it doesn't look mechanical.
    ctx.strokeStyle = 'rgba(60,30,8,0.28)';
    ctx.lineWidth = 1.2;
    const grainSeeds = [0.05, 0.13, 0.27, 0.38, 0.52, 0.61, 0.74, 0.85, 0.94];
    for (const t of grainSeeds) {
      const y = woodTop + (woodBot - woodTop) * t;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= width; x += 24) {
        ctx.lineTo(x, y + Math.sin(x * 0.04 + t * 9) * 1.6);
      }
      ctx.stroke();
    }
    // Knots
    for (const [kx, ky, kr] of [[width * 0.15, woodTop + 28, 4], [width * 0.78, woodTop + 56, 5]] as const) {
      ctx.fillStyle = 'rgba(40,20,8,0.5)';
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr * 1.4, kr, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,210,160,0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private drawOven(ctx: CanvasRenderingContext2D) {
    // A wood-fired pizza dome. Half-dome top on a stone base, brick texture,
    // dark arched mouth with flickering flames inside, chimney puffing smoke.
    const w = this.pizzaR * 2.7;
    const h = this.pizzaR * 2.7;
    const cx = this.ovenCenterX();
    const cy = this.pizzaY;
    ctx.save();
    ctx.translate(cx, cy);

    const stroke = '#3a2010';
    const stone1 = '#d6b890';
    const stone2 = '#bd9870';
    const stone3 = '#a37c54';

    // Stone base slab (rectangular hearth)
    const baseW = w * 0.95;
    const baseH = h * 0.18;
    ctx.fillStyle = '#7a4520';
    roundRect(ctx, -baseW / 2, h * 0.30, baseW, baseH, 6);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Wood-log fuel showing under the hearth
    ctx.fillStyle = '#5a3818';
    for (let i = 0; i < 3; i++) {
      const lx = -baseW * 0.32 + i * baseW * 0.30;
      ctx.beginPath();
      ctx.ellipse(lx, h * 0.30 + baseH * 0.5, baseW * 0.10, baseH * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2a1408';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#8a5a30';
      ctx.beginPath();
      ctx.arc(lx, h * 0.30 + baseH * 0.5, baseW * 0.03, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a3818';
    }

    // Dome — half ellipse with brick texture clipped inside.
    const domeW = w * 0.95;
    const domeH = h * 0.66;
    const domeTop = -h * 0.48;
    const domeBot = h * 0.30;

    // Outer dome silhouette (filled stone color first)
    ctx.fillStyle = stone1;
    ctx.beginPath();
    ctx.moveTo(-domeW / 2, domeBot);
    ctx.quadraticCurveTo(-domeW / 2 - 6, domeTop, 0, domeTop);
    ctx.quadraticCurveTo(domeW / 2 + 6, domeTop, domeW / 2, domeBot);
    ctx.closePath();
    ctx.fill();

    // Brick courses — clipped to the dome shape.
    ctx.save();
    ctx.clip();
    const brickH = h * 0.075;
    let rowI = 0;
    for (let y = domeTop; y < domeBot; y += brickH + 2) {
      const offsetX = (rowI % 2) * (domeW * 0.06);
      for (let x = -domeW / 2 - domeW * 0.06; x < domeW / 2; x += domeW * 0.12 + 2) {
        const shadeIdx = (rowI * 37 + Math.round(x * 0.3)) % 3;
        ctx.fillStyle = shadeIdx === 0 ? stone1 : shadeIdx === 1 ? stone2 : stone3;
        roundRect(ctx, x + offsetX, y, domeW * 0.12, brickH, 3);
        ctx.fill();
      }
      rowI++;
    }
    ctx.restore();
    // Outline the dome over the bricks.
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-domeW / 2, domeBot);
    ctx.quadraticCurveTo(-domeW / 2 - 6, domeTop, 0, domeTop);
    ctx.quadraticCurveTo(domeW / 2 + 6, domeTop, domeW / 2, domeBot);
    ctx.closePath();
    ctx.stroke();

    // Arched mouth — dark interior with flames when baking.
    const mouthW = domeW * 0.62;
    const mouthH = domeH * 0.62;
    const mouthCx = 0;
    const mouthCy = h * 0.07;
    const glowing = this.bakeT > 0.40 && this.bakeT < 0.85;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(mouthCx - mouthW / 2, mouthCy + mouthH * 0.50);
    ctx.lineTo(mouthCx - mouthW / 2, mouthCy - mouthH * 0.15);
    ctx.quadraticCurveTo(mouthCx - mouthW / 2 - 4, mouthCy - mouthH * 0.65, mouthCx, mouthCy - mouthH * 0.65);
    ctx.quadraticCurveTo(mouthCx + mouthW / 2 + 4, mouthCy - mouthH * 0.65, mouthCx + mouthW / 2, mouthCy - mouthH * 0.15);
    ctx.lineTo(mouthCx + mouthW / 2, mouthCy + mouthH * 0.50);
    ctx.closePath();
    // Background gradient: warm glow when baking, deep shadow otherwise.
    if (glowing) {
      const g = ctx.createRadialGradient(mouthCx, mouthCy, 0, mouthCx, mouthCy, mouthW * 0.7);
      g.addColorStop(0, '#ffd64a');
      g.addColorStop(0.5, '#f08438');
      g.addColorStop(1, '#7a2008');
      ctx.fillStyle = g;
    } else {
      const g = ctx.createRadialGradient(mouthCx, mouthCy, 0, mouthCx, mouthCy, mouthW * 0.7);
      g.addColorStop(0, '#3a1808');
      g.addColorStop(1, '#0a0402');
      ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.clip();
    // Flame tongues — only when baking. Flicker via phase based on time.
    if (glowing) {
      const t = performance.now() / 1000;
      ctx.fillStyle = '#ffe066';
      ctx.strokeStyle = '#a85008';
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const fx = mouthCx - mouthW * 0.35 + i * mouthW * 0.17;
        const fr = mouthW * (0.10 + Math.sin(t * 6 + i) * 0.02);
        const fh = mouthH * (0.30 + Math.sin(t * 4 + i * 1.3) * 0.05);
        const fy = mouthCy + mouthH * 0.30;
        ctx.beginPath();
        ctx.moveTo(fx - fr, fy);
        ctx.quadraticCurveTo(fx - fr * 0.6, fy - fh * 0.6, fx, fy - fh);
        ctx.quadraticCurveTo(fx + fr * 0.6, fy - fh * 0.6, fx + fr, fy);
        ctx.quadraticCurveTo(fx, fy + fh * 0.1, fx - fr, fy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      // Hot bed under flames
      ctx.fillStyle = '#ffa030';
      ctx.fillRect(mouthCx - mouthW / 2, mouthCy + mouthH * 0.40, mouthW, mouthH * 0.12);
    }
    ctx.restore();
    // Mouth outline
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(mouthCx - mouthW / 2, mouthCy + mouthH * 0.50);
    ctx.lineTo(mouthCx - mouthW / 2, mouthCy - mouthH * 0.15);
    ctx.quadraticCurveTo(mouthCx - mouthW / 2 - 4, mouthCy - mouthH * 0.65, mouthCx, mouthCy - mouthH * 0.65);
    ctx.quadraticCurveTo(mouthCx + mouthW / 2 + 4, mouthCy - mouthH * 0.65, mouthCx + mouthW / 2, mouthCy - mouthH * 0.15);
    ctx.lineTo(mouthCx + mouthW / 2, mouthCy + mouthH * 0.50);
    ctx.stroke();

    // Keystone brick at top of the arch
    ctx.fillStyle = stone2;
    roundRect(ctx, -domeW * 0.05, mouthCy - mouthH * 0.78, domeW * 0.10, domeH * 0.13, 3);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Chimney — slight angle, with smoke when baking
    const chW = w * 0.16;
    const chH = h * 0.30;
    const chX = domeW * 0.18;
    const chY = -h * 0.78;
    ctx.fillStyle = '#9a7050';
    roundRect(ctx, chX - chW / 2, chY, chW, chH, 6);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 4;
    ctx.stroke();
    // Chimney cap
    ctx.fillStyle = '#5a3818';
    roundRect(ctx, chX - chW * 0.65, chY - chH * 0.10, chW * 1.3, chH * 0.10, 3);
    ctx.fill();
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

// Slightly-wobbly circular blob — used everywhere a perfect circle would
// feel sterile. `wobble` is the relative amplitude of radius noise (0..0.2).
function blob(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, wobble: number, seed: number) {
  const n = 20;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wobbleVal = Math.sin(a * 3 + seed) * wobble + Math.sin(a * 5 + seed * 1.7) * wobble * 0.4;
    const rr = r * (1 + wobbleVal);
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
