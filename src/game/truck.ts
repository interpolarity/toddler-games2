import type { Material } from './excavator';

type TruckState = 'arriving' | 'waiting' | 'celebrating' | 'leaving';

interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  life: number;
  color: string;
  size: number;
}

interface BedSlab {
  material: Material;
  // for visual variation
  bumpSeed: number;
}

export class Truck {
  x: number;
  parkX: number;
  state: TruckState = 'arriving';
  scale: number;
  groundY: number;
  loadsWanted: number;
  loadsReceived = 0;
  bedSlabs: BedSlab[] = [];
  celebrationTimer = 0;
  wheelRot = 0;
  particles: Confetti[] = [];
  bedShake = 0; // visual jolt when receiving a load

  constructor(scale: number, groundY: number, parkX: number, sceneWidth: number, loads: number) {
    this.scale = scale;
    this.groundY = groundY;
    this.parkX = parkX;
    this.loadsWanted = loads;
    // Spawn off-screen to the right; reverses in (cab leading, bed presented to excavator on its left).
    this.x = sceneWidth + scale * 0.9;
  }

  // Returns true if the bucket position is over the receiving zone above the truck bed.
  isDumpZone(x: number, y: number): boolean {
    if (this.state !== 'waiting') return false;
    const bedLeft = this.x - this.scale * 0.55;
    const bedRight = this.x - this.scale * 0.05;
    const yMax = this.groundY - this.scale * 0.10;
    return x >= bedLeft && x <= bedRight && y <= yMax + 30;
  }

  receiveLoad(material: Material): boolean {
    if (this.state !== 'waiting') return false;
    this.loadsReceived++;
    this.bedSlabs.push({ material, bumpSeed: Math.random() * 1000 });
    this.bedShake = 1;
    this.spawnReceiveSparks();
    if (this.loadsReceived >= this.loadsWanted) {
      this.state = 'celebrating';
      this.celebrationTimer = 0;
      this.spawnConfetti();
    }
    return true;
  }

  private spawnReceiveSparks() {
    const colors = ['#feca57', '#ff9ff3', '#48dbfb', '#1dd1a1'];
    for (let i = 0; i < 14; i++) {
      this.particles.push({
        x: this.x - this.scale * 0.30 + (Math.random() - 0.5) * this.scale * 0.40,
        y: this.groundY - this.scale * 0.42,
        vx: (Math.random() - 0.5) * 130,
        vy: -90 - Math.random() * 110,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 12,
        life: 0.7 + Math.random() * 0.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.random() * 2,
      });
    }
  }

  private spawnConfetti() {
    const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#ee5253', '#a55eea', '#ff9ff3', '#ffd6a5'];
    for (let i = 0; i < 60; i++) {
      this.particles.push({
        x: this.x - this.scale * 0.20 + (Math.random() - 0.5) * this.scale * 0.6,
        y: this.groundY - this.scale * 0.50,
        vx: (Math.random() - 0.5) * 280,
        vy: -180 - Math.random() * 220,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 18,
        life: 1.4 + Math.random() * 1.2,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 5 + Math.random() * 3,
      });
    }
  }

  update(dt: number) {
    if (this.state === 'arriving') {
      const speed = this.scale * 1.6;
      this.x = Math.max(this.x - speed * dt, this.parkX);
      // Reversing — wheels turn the wrong way relative to motion.
      this.wheelRot += (speed * dt) / (this.scale * 0.07);
      if (this.x <= this.parkX + 0.5) {
        this.state = 'waiting';
        this.x = this.parkX;
      }
    } else if (this.state === 'celebrating') {
      this.celebrationTimer += dt;
      if (this.celebrationTimer > 1.4) {
        this.state = 'leaving';
      }
    } else if (this.state === 'leaving') {
      const speed = this.scale * 2.2;
      this.x += speed * dt;
      this.wheelRot += (speed * dt) / (this.scale * 0.07);
    }

    if (this.bedShake > 0) {
      this.bedShake = Math.max(0, this.bedShake - dt * 4);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 520 * dt;
      p.vx *= Math.pow(0.5, dt);
      p.rot += p.vrot * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y > this.groundY + 80) this.particles.splice(i, 1);
    }
  }

  isGone(sceneWidth: number): boolean {
    return this.state === 'leaving' && this.x > sceneWidth + this.scale * 1.5;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const s = this.scale;
    // Apply small bed shake offset to the truck body (not the wheels).
    const shakeY = this.bedShake > 0 ? Math.sin(this.bedShake * 30) * 2 : 0;
    const x = this.x;
    const y = this.groundY;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(x - s * 0.10, y + s * 0.05, s * 0.55, s * 0.030, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wheels
    const wheelXs = [-s * 0.40, s * 0.05, s * 0.20];
    for (const wx of wheelXs) {
      this.drawWheel(ctx, x + wx, y - s * 0.06, s * 0.085, this.wheelRot);
    }

    // Save for shake (body only)
    ctx.save();
    ctx.translate(0, shakeY);

    // Chassis under bed
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(x - s * 0.50, y - s * 0.13, s * 0.70, s * 0.06);
    // Mud guards
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x - s * 0.46, y - s * 0.15, s * 0.10, s * 0.04);
    ctx.fillRect(x + s * 0.10, y - s * 0.15, s * 0.10, s * 0.04);

    // Dump bed (left half) — open box, sides higher than the front sloped panel
    const bedX = x - s * 0.55;
    const bedY = y - s * 0.46;
    const bedW = s * 0.62;
    const bedH = s * 0.34;

    // Outer walls (red-orange)
    const bedGrad = ctx.createLinearGradient(bedX, bedY, bedX, bedY + bedH);
    bedGrad.addColorStop(0, '#ff8c42');
    bedGrad.addColorStop(0.6, '#e85a18');
    bedGrad.addColorStop(1, '#a83a08');
    ctx.fillStyle = bedGrad;
    ctx.beginPath();
    // Back-left wall (taller, vertical)
    ctx.moveTo(bedX, y - s * 0.13);
    ctx.lineTo(bedX, bedY);
    // Top edge across the bed
    ctx.lineTo(bedX + bedW * 0.85, bedY);
    // Slope down to front (toward the cab)
    ctx.lineTo(bedX + bedW, bedY + bedH * 0.55);
    ctx.lineTo(bedX + bedW, y - s * 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#7a2810';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Side rib detail
    ctx.strokeStyle = '#7a2810';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const rx = bedX + (bedW * 0.85) * (i / 4);
      ctx.beginPath();
      ctx.moveTo(rx, bedY + 4);
      ctx.lineTo(rx, y - s * 0.14);
      ctx.stroke();
    }

    // Bed inside — shadowed cavity (visible along the upper rim opening)
    ctx.fillStyle = '#2a1408';
    ctx.fillRect(bedX + 4, bedY + 4, bedW * 0.85 - 8, bedH - 14);

    // Bed material slabs (each load adds a visible layer)
    if (this.bedSlabs.length > 0) {
      const slabBase = y - s * 0.16;
      const slabAreaH = bedH - 16;
      const slabH = Math.min(slabAreaH / Math.max(this.bedSlabs.length, 1), s * 0.05);
      let cy = slabBase;
      for (let i = 0; i < this.bedSlabs.length; i++) {
        const slab = this.bedSlabs[i];
        const colors = slab.material === 'rock'
          ? ['#5a5550', '#8a8580']
          : slab.material === 'clay'
          ? ['#8a4f20', '#c08850']
          : ['#6e4810', '#a87420'];
        ctx.fillStyle = colors[0];
        ctx.fillRect(bedX + 6, cy - slabH, bedW * 0.85 - 12, slabH);
        // Bumpy top (only on the topmost slab)
        if (i === this.bedSlabs.length - 1) {
          ctx.fillStyle = colors[1];
          const segs = 8;
          for (let j = 0; j < segs; j++) {
            const sx = bedX + 6 + ((bedW * 0.85 - 12) * j) / segs;
            const sw = (bedW * 0.85 - 12) / segs;
            const bump = Math.sin(j * 1.7 + slab.bumpSeed) * 1.2;
            ctx.fillRect(sx, cy - slabH + bump, sw, 2);
          }
        }
        cy -= slabH;
      }
    }

    // Cab (right side) — sloped windshield, single window, headlight
    const cabX = x + s * 0.18;
    const cabTopY = y - s * 0.36;
    const cabGrad = ctx.createLinearGradient(cabX - s * 0.12, cabTopY, cabX + s * 0.12, y - s * 0.10);
    cabGrad.addColorStop(0, '#ffd97a');
    cabGrad.addColorStop(1, '#e8a830');
    ctx.fillStyle = cabGrad;
    ctx.beginPath();
    ctx.moveTo(cabX - s * 0.13, y - s * 0.13);
    ctx.lineTo(cabX - s * 0.13, y - s * 0.32);
    ctx.lineTo(cabX - s * 0.10, cabTopY);
    ctx.lineTo(cabX + s * 0.13, cabTopY);
    ctx.lineTo(cabX + s * 0.13, y - s * 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#9a3a08';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Door seam
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cabX - s * 0.02, y - s * 0.13);
    ctx.lineTo(cabX - s * 0.02, y - s * 0.30);
    ctx.stroke();

    // Cab window
    ctx.fillStyle = '#cce8ff';
    ctx.beginPath();
    ctx.moveTo(cabX - s * 0.08, y - s * 0.32);
    ctx.lineTo(cabX - s * 0.06, cabTopY + 2);
    ctx.lineTo(cabX + s * 0.10, cabTopY + 2);
    ctx.lineTo(cabX + s * 0.10, y - s * 0.20);
    ctx.lineTo(cabX - s * 0.08, y - s * 0.20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#9a3a08';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Window highlight
    ctx.fillStyle = 'rgba(255,255,255,0.40)';
    ctx.beginPath();
    ctx.moveTo(cabX - s * 0.06, y - s * 0.30);
    ctx.lineTo(cabX - s * 0.02, y - s * 0.30);
    ctx.lineTo(cabX - s * 0.06, y - s * 0.22);
    ctx.closePath();
    ctx.fill();

    // Headlight
    ctx.fillStyle = '#fff5b0';
    ctx.beginPath();
    ctx.arc(cabX + s * 0.13, y - s * 0.18, s * 0.022, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9a3a08';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Grille
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(cabX + s * 0.11, y - s * 0.15, s * 0.04, s * 0.05);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#666';
      ctx.fillRect(cabX + s * 0.115, y - s * 0.145 + i * s * 0.013, s * 0.03, 1.5);
    }

    // Exhaust stack on cab
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(cabX - s * 0.08, y - s * 0.46, s * 0.025, s * 0.10);
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.arc(cabX - s * 0.068, y - s * 0.46, s * 0.018, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Counter bubble — shows how many loads still needed.
    this.drawCounterBubble(ctx, x - s * 0.20, bedY - s * 0.11, s * 0.22, s * 0.20);

    // Particles last so they sit on top
    for (const p of this.particles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, p.life * 1.2);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawCounterBubble(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
    if (this.state === 'leaving') return;
    const remaining = Math.max(0, this.loadsWanted - this.loadsReceived);
    const pulse = this.state === 'waiting' ? 1 + Math.sin(performance.now() * 0.005) * 0.06 : 1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    this.roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.32);
    ctx.fill();
    ctx.strokeStyle = '#9a3a08';
    ctx.lineWidth = 3;
    ctx.stroke();
    if (this.state === 'celebrating') {
      ctx.fillStyle = '#2ea84a';
      ctx.font = `bold ${Math.round(h * 0.85)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓', 0, 2);
    } else {
      // Big numeral
      ctx.fillStyle = '#3a2818';
      ctx.font = `bold ${Math.round(h * 0.7)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(remaining), 0, 2);
      // Dots showing total goal (filled = received)
      const dots = this.loadsWanted;
      const dotR = Math.min(h * 0.07, w / (dots * 2.2));
      const totalW = dots * dotR * 2 + (dots - 1) * dotR;
      const startX = -totalW / 2 + dotR;
      const dy = h * 0.42;
      for (let i = 0; i < dots; i++) {
        const dx = startX + i * dotR * 3;
        ctx.fillStyle = i < this.loadsReceived ? '#2ea84a' : 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Pointer
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2 + 8);
    ctx.lineTo(-7, h / 2);
    ctx.lineTo(7, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#9a3a08';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private drawWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number) {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = '#999';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
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
