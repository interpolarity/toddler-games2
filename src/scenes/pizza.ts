import type { FrameContext, Scene, SceneNavigator } from '../types';
import { AudioBus } from '../game/audio';
import { drawHomeButton, isOverHomeButton } from '../ui/homeButton';

type ToppingType = 'pepperoni' | 'mushroom' | 'olive' | 'pepper';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const TOPPING_WORD: Record<ToppingType, string> = {
  pepperoni: 'pepperoni',
  mushroom: 'mushroom',
  olive: 'olive',
  pepper: 'pepper',
};
const TOPPING_COLOR_WORD: Record<ToppingType, string> = {
  pepperoni: 'red',
  mushroom: 'brown',
  olive: 'black',
  pepper: 'green',
};
const CHEERS = ['Yum!', 'Delicious!', 'Tasty!', 'Mmm!', 'Yummy!'];

interface PlacedTopping {
  type: ToppingType;
  rx: number; // relative to pizza center, normalized
  ry: number;
  rot: number;
  scale: number;
}

interface FlyingTopping {
  type: ToppingType;
  fromX: number; fromY: number;
  toX: number; toY: number;
  t: number; // 0..1
  duration: number;
  spin: number;
  // Final landing on the pizza (in pizza-relative normalized coords)
  rx: number; ry: number;
}

interface TraySlot {
  type: ToppingType;
  x: number; y: number; r: number;
  shake: number; // 0..1 wrong-tap shake animation
}

interface Order {
  type: ToppingType;
  goal: number;
  done: number;
}

export class PizzaScene implements Scene {
  private nav: SceneNavigator;
  private audio = new AudioBus();
  private audioUnlocked = false;

  // Pizza
  private pizzaX = 0;
  private pizzaY = 0;
  private pizzaR = 0;
  private placed: PlacedTopping[] = [];
  private flying: FlyingTopping[] = [];
  private pizzaShimmer = 0; // 0..1 brief sparkle when finished
  private pizzaScale = 1;

  private tray: TraySlot[] = [];
  private order: Order = { type: 'pepperoni', goal: 3, done: 0 };

  private pizzasMade = 0;
  private totalPizzas = 3;
  private state: 'making' | 'between' | 'done' = 'making';
  private betweenTimer = 0;

  // Win-state confetti reusing the digger pattern
  private confetti: Array<{ x: number; y: number; vx: number; vy: number; rot: number; vrot: number; life: number; color: string; size: number }> = [];
  private completeAt = 0;

  // Drag binding
  private dragPointerId: number | null = null;
  private cachedWidth = 0;
  private cachedHeight = 0;

  constructor(nav: SceneNavigator) {
    this.nav = nav;
  }

  onEnter(ctx: FrameContext) { this.layout(ctx); this.startNextOrder(true); }
  onResize(ctx: FrameContext) { this.layout(ctx); }

  private layout({ width, height, orientation }: FrameContext) {
    this.cachedWidth = width;
    this.cachedHeight = height;
    const portrait = orientation === 'portrait';
    // Pizza in middle-upper area, tray below in portrait or to the right in landscape.
    const baseScale = Math.min(width, height);
    if (portrait) {
      this.pizzaX = width / 2;
      this.pizzaY = height * 0.40;
      this.pizzaR = baseScale * 0.30;
      // Tray row at bottom
      const types: ToppingType[] = ['pepperoni', 'mushroom', 'olive', 'pepper'];
      const slotR = baseScale * 0.085;
      const trayY = height * 0.82;
      const span = (types.length - 1) * (slotR * 2.7);
      this.tray = types.map((t, i) => ({
        type: t,
        x: width / 2 - span / 2 + i * (slotR * 2.7),
        y: trayY,
        r: slotR,
        shake: 0,
      }));
    } else {
      this.pizzaX = width * 0.38;
      this.pizzaY = height * 0.55;
      this.pizzaR = baseScale * 0.36;
      const types: ToppingType[] = ['pepperoni', 'mushroom', 'olive', 'pepper'];
      const slotR = baseScale * 0.085;
      const trayX = width * 0.82;
      const span = (types.length - 1) * (slotR * 2.7);
      this.tray = types.map((t, i) => ({
        type: t,
        x: trayX,
        y: height / 2 - span / 2 + i * (slotR * 2.7),
        r: slotR,
        shake: 0,
      }));
    }
  }

  private startNextOrder(initial: boolean) {
    const types: ToppingType[] = ['pepperoni', 'mushroom', 'olive', 'pepper'];
    const type = types[Math.floor(Math.random() * types.length)];
    const goal = 2 + Math.floor(Math.random() * 4); // 2..5
    this.order = { type, goal, done: 0 };
    this.placed = [];
    this.flying = [];
    this.pizzaShimmer = 0;
    this.state = 'making';
    if (!initial && this.audioUnlocked) {
      setTimeout(() => this.audio.speak(`${this.order.goal} ${TOPPING_WORD[this.order.type]}!`), 100);
    }
  }

  update({ pointers, dt }: FrameContext) {
    if (!this.audioUnlocked && pointers.size > 0) {
      this.audio.unlock();
      this.audioUnlocked = true;
    }

    // Done state: tap to replay (after grace).
    if (this.state === 'done') {
      this.updateConfetti(dt);
      const elapsed = (performance.now() - this.completeAt) / 1000;
      if (elapsed > 2.0 && pointers.size > 0) {
        this.pizzasMade = 0;
        this.confetti.length = 0;
        this.startNextOrder(true);
      }
      return;
    }

    // Between-orders settle period.
    if (this.state === 'between') {
      this.betweenTimer -= dt;
      this.pizzaScale += ((1 + 0.05 * Math.sin(this.betweenTimer * 6)) - this.pizzaScale) * 0.2;
      this.advanceFlying(dt);
      // While the celebration plays, ignore taps so kids don't accidentally skip.
      if (this.betweenTimer <= 0) {
        if (this.pizzasMade >= this.totalPizzas) {
          this.triggerComplete();
        } else {
          this.startNextOrder(false);
        }
      }
      return;
    }

    // Tray + home button hit-tests on first pointer down.
    if (this.dragPointerId !== null) {
      const p = pointers.get(this.dragPointerId);
      if (!p || !p.down) this.dragPointerId = null;
    }
    if (this.dragPointerId === null) {
      for (const p of pointers.values()) {
        if (!p.down) continue;
        // Home
        if (isOverHomeButton(p.x, p.y, this.cachedWidth, this.cachedHeight)) {
          this.nav.go('menu');
          return;
        }
        // Tray slot
        const slot = this.tray.find(s => {
          const dx = p.x - s.x; const dy = p.y - s.y;
          return dx * dx + dy * dy <= s.r * s.r;
        });
        if (slot) {
          this.handleTrayTap(slot);
        }
        this.dragPointerId = p.id;
        break;
      }
    }

    // Tray shake decay
    for (const s of this.tray) {
      if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 4);
    }

    // Flying toppings approach the pizza
    this.advanceFlying(dt);

    // Pizza shimmer decay after completion
    if (this.pizzaShimmer > 0) this.pizzaShimmer = Math.max(0, this.pizzaShimmer - dt);

    // Pizza idle scale settle
    this.pizzaScale += (1 - this.pizzaScale) * Math.min(1, dt * 6);
  }

  private advanceFlying(dt: number) {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt / f.duration;
      if (f.t >= 1) {
        // Land on pizza
        this.placed.push({ type: f.type, rx: f.rx, ry: f.ry, rot: f.spin, scale: 1 });
        if (this.audioUnlocked) this.audio.playClunk();
        this.flying.splice(i, 1);
        // Pizza pop
        this.pizzaScale = 1.05;
        // Check if order complete
        if (this.order.done >= this.order.goal && this.state === 'making') {
          this.finishPizza();
        }
      }
    }
  }

  private handleTrayTap(slot: TraySlot) {
    if (slot.type !== this.order.type) {
      slot.shake = 1;
      if (this.audioUnlocked) {
        this.audio.speak(`Find the ${TOPPING_COLOR_WORD[this.order.type]} ones!`);
      }
      return;
    }
    if (this.order.done >= this.order.goal) return;
    this.order.done++;
    // Pick a landing spot on the pizza in normalized coords (uniform within disk, away from edge).
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * 0.78;
    const rx = Math.cos(ang) * dist;
    const ry = Math.sin(ang) * dist;
    const targetX = this.pizzaX + rx * this.pizzaR;
    const targetY = this.pizzaY + ry * this.pizzaR;
    this.flying.push({
      type: slot.type,
      fromX: slot.x, fromY: slot.y,
      toX: targetX, toY: targetY,
      t: 0,
      duration: 0.45,
      spin: Math.random() * Math.PI * 2,
      rx, ry,
    });
    if (this.audioUnlocked) {
      this.audio.playSparkle();
      const n = this.order.done;
      setTimeout(() => this.audio.speak(NUMBER_WORDS[Math.min(n, 10)]), 120);
    }
    if ('vibrate' in navigator) navigator.vibrate?.(8);
  }

  private finishPizza() {
    this.state = 'between';
    this.betweenTimer = 1.6;
    this.pizzaShimmer = 1;
    this.pizzasMade += 1;
    if (this.audioUnlocked) {
      this.audio.playFanfare();
      setTimeout(() => this.audio.speak(CHEERS[Math.floor(Math.random() * CHEERS.length)]), 350);
    }
  }

  private triggerComplete() {
    this.state = 'done';
    this.completeAt = performance.now();
    if (this.audioUnlocked) {
      this.audio.playFanfare();
      setTimeout(() => this.audio.playFanfare(), 700);
      setTimeout(() => this.audio.speak('All done! Yum!'), 1300);
    }
    if ('vibrate' in navigator) navigator.vibrate?.([20, 80, 20, 80, 40]);
    this.spawnConfetti(80);
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

  private updateConfetti(dt: number) {
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const p = this.confetti[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; p.vx *= Math.pow(0.5, dt); p.rot += p.vrot * dt; p.life -= dt;
      if (p.life <= 0 || p.y > this.cachedHeight + 50) this.confetti.splice(i, 1);
    }
    if (this.confetti.length < 80 && Math.random() < 0.7) this.spawnConfetti(4);
  }

  render({ ctx, width, height }: FrameContext) {
    // Background — warm, cozy
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#fff1d3');
    bg.addColorStop(1, '#ffd5a5');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Subtle table grain
    ctx.fillStyle = 'rgba(170, 100, 40, 0.08)';
    for (let y = 0; y < height; y += 18) {
      ctx.fillRect(0, y, width, 1);
    }

    // Order card
    this.drawOrderCard(ctx, width, height);

    // Pizza
    this.drawPizza(ctx);

    // Tray
    for (const slot of this.tray) {
      this.drawTraySlot(ctx, slot);
    }

    // Flying toppings (drawn over pizza so they're visible mid-flight)
    for (const f of this.flying) {
      const k = Math.min(1, f.t);
      const x = f.fromX + (f.toX - f.fromX) * k;
      const y = f.fromY + (f.toY - f.fromY) * k - Math.sin(k * Math.PI) * 60;
      const scale = 1 - k * 0.15;
      this.drawTopping(ctx, x, y, f.type, scale, f.spin + k * 4);
    }

    // Pizza counter (X / 3) bottom corner
    this.drawProgress(ctx, width, height);

    // Home button
    drawHomeButton(ctx, width, height);

    if (this.state === 'done') this.drawCompleteOverlay(ctx, width, height);
  }

  private drawOrderCard(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (this.state !== 'making') return;
    const cardW = Math.min(width * 0.65, 440);
    const cardH = Math.min(height * 0.12, 88);
    const x = (width - cardW) / 2;
    const y = 12;
    // Card bg
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    roundRect(ctx, x, y, cardW, cardH, 14);
    ctx.fill();
    ctx.strokeStyle = '#aa5510';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Goal icon on left
    const iconR = cardH * 0.36;
    const iconX = x + iconR + 16;
    const iconY = y + cardH / 2;
    this.drawTopping(ctx, iconX, iconY, this.order.type, 1.2, 0);
    // Big goal number
    ctx.font = `900 ${Math.round(cardH * 0.7)}px system-ui, sans-serif`;
    ctx.fillStyle = '#3a2818';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${this.order.goal}`, iconX + iconR + 24, iconY + 2);
    // Done count chip
    ctx.font = `bold ${Math.round(cardH * 0.32)}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7a4f10';
    ctx.fillText(`${this.order.done} / ${this.order.goal}`, x + cardW - 16, iconY + 2);
  }

  private drawPizza(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.pizzaX, this.pizzaY);
    ctx.scale(this.pizzaScale, this.pizzaScale);
    const r = this.pizzaR;
    // Plate
    ctx.fillStyle = '#f3edd8';
    ctx.beginPath();
    ctx.arc(0, r * 0.05, r * 1.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d4cba2';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Crust outer
    const crustGrad = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r);
    crustGrad.addColorStop(0, '#d8893a');
    crustGrad.addColorStop(1, '#9a5818');
    ctx.fillStyle = crustGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // Sauce + cheese
    ctx.fillStyle = '#fdd96a';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(228, 86, 56, 0.55)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
    ctx.fill();
    // Cheese melt blobs
    ctx.fillStyle = 'rgba(255, 235, 140, 0.85)';
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + (i * 0.37);
      const dist = (0.3 + (i % 3) * 0.18) * r;
      const bx = Math.cos(a) * dist;
      const by = Math.sin(a) * dist;
      ctx.beginPath();
      ctx.ellipse(bx, by, r * 0.10, r * 0.07, i, 0, Math.PI * 2);
      ctx.fill();
    }
    // Crust dents (slight bumps along edge)
    ctx.strokeStyle = '#c87a30';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
    ctx.stroke();
    // Placed toppings
    for (const p of this.placed) {
      this.drawTopping(ctx, p.rx * r, p.ry * r, p.type, p.scale, p.rot);
    }
    // Shimmer
    if (this.pizzaShimmer > 0) {
      const shimGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.2);
      shimGrad.addColorStop(0, `rgba(255,255,210,${0.5 * this.pizzaShimmer})`);
      shimGrad.addColorStop(1, 'rgba(255,255,210,0)');
      ctx.fillStyle = shimGrad;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawTraySlot(ctx: CanvasRenderingContext2D, s: TraySlot) {
    const isTarget = s.type === this.order.type && this.state === 'making';
    const shake = s.shake > 0 ? Math.sin(s.shake * 30) * s.shake * 6 : 0;
    ctx.save();
    ctx.translate(s.x + shake, s.y);
    // Bowl bg
    const fill = isTarget ? '#fff8d8' : '#f3edd8';
    const ring = isTarget ? '#f0a020' : '#c8b888';
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ring;
    ctx.lineWidth = isTarget ? 5 : 3;
    ctx.stroke();
    // Topping inside
    this.drawTopping(ctx, 0, 0, s.type, 1.6, 0);
    // Pulse ring on the target slot to nudge attention
    if (isTarget) {
      const t = (performance.now() / 800) % 1;
      ctx.strokeStyle = `rgba(240,160,32,${(1 - t) * 0.7})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, s.r + t * 14, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawProgress(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const sz = Math.min(width, height) * 0.08;
    const padX = 14, padY = 14;
    const x = padX, y = padY;
    // Bubble
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    roundRect(ctx, x, y, sz * 2.6, sz * 0.9, sz * 0.45);
    ctx.fill();
    ctx.strokeStyle = '#aa5510';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Mini pizza icons — filled if made, hollow if pending
    for (let i = 0; i < this.totalPizzas; i++) {
      const cx = x + sz * 0.6 + i * sz * 0.7;
      const cy = y + sz * 0.45;
      const r = sz * 0.28;
      if (i < this.pizzasMade) {
        ctx.fillStyle = '#c87a30';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fdd96a';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c8333a';
        ctx.beginPath();
        ctx.arc(cx - r * 0.25, cy - r * 0.1, r * 0.18, 0, Math.PI * 2);
        ctx.arc(cx + r * 0.20, cy + r * 0.20, r * 0.16, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#aa5510';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
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
    const t = (performance.now() - this.completeAt) / 1000;
    const bob = Math.sin(t * 3.2) * 6;
    const titleSize = Math.min(width, height) * 0.13;
    ctx.font = `900 ${Math.round(titleSize)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(8, titleSize * 0.10);
    ctx.strokeStyle = '#fff';
    ctx.strokeText('ALL DONE!', width / 2, height * 0.40 + bob);
    const titleGrad = ctx.createLinearGradient(0, height * 0.34, 0, height * 0.48);
    titleGrad.addColorStop(0, '#ff8c42');
    titleGrad.addColorStop(1, '#aa3a08');
    ctx.fillStyle = titleGrad;
    ctx.fillText('ALL DONE!', width / 2, height * 0.40 + bob);
    if (t > 2.0) {
      const pulse = 0.65 + Math.sin(t * 4) * 0.35;
      ctx.globalAlpha = pulse;
      const hintSize = Math.min(width, height) * 0.045;
      ctx.font = `bold ${Math.round(hintSize)}px system-ui, sans-serif`;
      ctx.fillStyle = '#3a2818';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.strokeText('Tap to play again', width / 2, height * 0.62);
      ctx.fillText('Tap to play again', width / 2, height * 0.62);
      ctx.globalAlpha = 1;
    }
  }

  // ==================== Topping art ====================

  private drawTopping(ctx: CanvasRenderingContext2D, x: number, y: number, type: ToppingType, scale: number, rot: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    if (type === 'pepperoni') this.drawPepperoni(ctx);
    else if (type === 'mushroom') this.drawMushroom(ctx);
    else if (type === 'olive') this.drawOlive(ctx);
    else this.drawPepper(ctx);
    ctx.restore();
  }

  private drawPepperoni(ctx: CanvasRenderingContext2D) {
    // Red-orange disc with darker dots for spice flecks.
    const grad = ctx.createRadialGradient(-2, -2, 1, 0, 0, 12);
    grad.addColorStop(0, '#e8553a');
    grad.addColorStop(1, '#a8281a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7a1810';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#5a1008';
    for (const [px, py] of [[-3, -2], [3, 1], [-1, 4], [4, -3]]) {
      ctx.beginPath();
      ctx.arc(px, py, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawMushroom(ctx: CanvasRenderingContext2D) {
    // Brown half-dome cap + cream stem.
    ctx.fillStyle = '#9a6a40';
    ctx.beginPath();
    ctx.arc(0, -1, 11, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#5a3a18';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#f3e2c0';
    ctx.fillRect(-5, -1, 10, 5);
    ctx.strokeRect(-5, -1, 10, 5);
    // Cap highlight
    ctx.fillStyle = 'rgba(255,210,160,0.5)';
    ctx.beginPath();
    ctx.arc(-3, -3, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawOlive(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Hole in the middle (sliced olive)
    ctx.fillStyle = '#5a3010';
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(-3, -3, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPepper(ctx: CanvasRenderingContext2D) {
    // Green ring (slice of bell pepper).
    ctx.fillStyle = '#3da53a';
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.arc(0, 0, 5, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#1f5f1d';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.stroke();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(-4, -4, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
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
