// Realistic excavator with 2-link IK on the boom/stick and a real bucket.
// The user drags a target point; boom and stick angles are computed so the
// wrist (bucket pivot) reaches that target. Bucket auto-curls based on whether
// it's at digging depth or lifted high to dump.

export type Material = 'dirt' | 'clay' | 'rock';

export const BOOM_LEN = 0.62;
export const STICK_LEN = 0.48;
const BUCKET_LEN = 0.20;

export class Excavator {
  x: number;
  y: number;
  scale: number;

  targetX: number;
  targetY: number;

  boomAngle = -0.6;
  stickAngle = 0.5;
  bucketAngle = 0.4;

  fill = 0;
  fillMaterial: Material = 'dirt';

  dumping = false;
  private dumpTimer = 0;
  private idle = 0;
  private prevX: number;
  wheelRot = 0;
  driving = false;

  constructor(x: number, y: number, scale: number) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.prevX = x;
    this.targetX = x + scale * 0.55;
    this.targetY = y - scale * 0.15;
  }

  isOverBody(x: number, y: number): boolean {
    const s = this.scale;
    return x >= this.x - s * 0.55 && x <= this.x + s * 0.32 &&
           y >= this.y - s * 0.60 && y <= this.y + s * 0.12;
  }

  driveTo(targetX: number, dt: number) {
    const speed = this.scale * 1.8; // px/sec
    const dx = targetX - this.x;
    const adx = dx < 0 ? -dx : dx;
    if (adx < 0.5) {
      this.x = targetX;
      return;
    }
    const dir = dx < 0 ? -1 : 1;
    const move = dir * (speed * dt < adx ? speed * dt : adx);
    this.x += move;
  }

  setBucketTarget(x: number, y: number) {
    // Don't let target collapse to shoulder — IK degenerates
    const sh = this.getShoulderPos();
    const dx = x - sh.x;
    const dy = y - sh.y;
    const d = Math.hypot(dx, dy);
    const min = this.scale * 0.12;
    if (d < min) {
      const k = min / Math.max(d, 0.0001);
      this.targetX = sh.x + dx * k;
      this.targetY = sh.y + dy * k;
    } else {
      this.targetX = x;
      this.targetY = y;
    }
  }

  getShoulderPos() {
    return { x: this.x + this.scale * 0.10, y: this.y - this.scale * 0.34 };
  }

  getBoomEnd() {
    const sh = this.getShoulderPos();
    return {
      x: sh.x + Math.cos(this.boomAngle) * this.scale * BOOM_LEN,
      y: sh.y + Math.sin(this.boomAngle) * this.scale * BOOM_LEN,
    };
  }

  getBucketPivot() {
    const be = this.getBoomEnd();
    return {
      x: be.x + Math.cos(this.stickAngle) * this.scale * STICK_LEN,
      y: be.y + Math.sin(this.stickAngle) * this.scale * STICK_LEN,
    };
  }

  // Approximate position of the bucket's working zone (for terrain interaction)
  getBucketWorkPoint() {
    const piv = this.getBucketPivot();
    const total = this.stickAngle + this.bucketAngle;
    const len = this.scale * BUCKET_LEN;
    return {
      x: piv.x + Math.cos(total + 0.3) * len * 0.7,
      y: piv.y + Math.sin(total + 0.3) * len * 0.7,
      r: len * 0.55,
    };
  }

  triggerDump() {
    if (this.fill > 0 && !this.dumping) {
      this.dumping = true;
      this.dumpTimer = 0;
    }
  }

  update(dt: number, groundY: number) {
    this.idle += dt;

    // Wheel rotation tracks actual horizontal movement so sprockets and
    // road wheels only spin when the excavator is driving.
    const moveDx = this.x - this.prevX;
    if (moveDx !== 0) this.wheelRot += moveDx / (this.scale * 0.075);
    this.prevX = this.x;

    // 2-link IK
    const sh = this.getShoulderPos();
    const dx = this.targetX - sh.x;
    const dy = this.targetY - sh.y;
    const L1 = this.scale * BOOM_LEN;
    const L2 = this.scale * STICK_LEN;
    let d = Math.hypot(dx, dy);
    const minD = Math.abs(L1 - L2) + 1;
    const maxD = L1 + L2 - 1;
    if (d < minD) d = minD;
    if (d > maxD) d = maxD;

    const beta = Math.atan2(dy, dx);
    const cosAlpha = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));
    const cosGamma = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
    const gamma = Math.acos(Math.max(-1, Math.min(1, cosGamma)));

    const targetBoom = beta - alpha;
    const targetStick = targetBoom + Math.PI - gamma;

    // Frame-rate-independent exponential smoothing on the IK angles.
    // Higher rate = snappier response. Tuned so the arm reaches ~91% of
    // target in about 0.15 s, which keeps fast finger drags responsive.
    const armK = 1 - Math.exp(-15 * dt);
    this.boomAngle += (targetBoom - this.boomAngle) * armK;
    this.stickAngle += (targetStick - this.stickAngle) * armK;

    // Bucket curl logic
    const wrist = this.getBucketPivot();
    const isLow = wrist.y > groundY - this.scale * 0.05;
    const isHigh = wrist.y < groundY - this.scale * 0.55;

    let targetBucket: number;
    if (this.dumping) {
      targetBucket = -0.7;
      this.dumpTimer += dt;
      // Short tip-and-recover. Particles spawn once at the dump trigger and
      // the scene resets fill there, so the bucket can rejoin digging fast.
      if (this.dumpTimer > 0.30) {
        this.dumping = false;
        this.dumpTimer = 0;
      }
    } else if (isHigh && this.fill > 0.05) {
      this.dumping = true;
      this.dumpTimer = 0;
      targetBucket = 0.4;
    } else if (isLow) {
      targetBucket = 0.85;
    } else {
      targetBucket = 0.4;
    }
    // Bucket curl can be a bit punchier than the arm (it's lighter).
    const bucketK = 1 - Math.exp(-22 * dt);
    this.bucketAngle += (targetBucket - this.bucketAngle) * bucketK;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const s = this.scale;
    const x = this.x;
    const y = this.y;

    // Soft ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.05, s * 0.55, s * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();

    this.drawTracks(ctx, x, y, s);
    this.drawHouse(ctx, x, y, s);
    this.drawArm(ctx);
  }

  private drawTracks(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    // Track frame
    ctx.fillStyle = '#1a1a1a';
    this.roundRect(ctx, x - s * 0.50, y - s * 0.13, s * 1.0, s * 0.20, s * 0.05);
    ctx.fill();

    // Inner shadow strip
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(x - s * 0.46, y - s * 0.08, s * 0.92, s * 0.05);

    // Grouser plates (cleats on the track)
    ctx.fillStyle = '#2c2c2c';
    const plates = 16;
    for (let i = 0; i < plates; i++) {
      const tx = x - s * 0.48 + i * (s * 0.96) / plates;
      ctx.fillRect(tx, y - s * 0.13, s * 0.04, s * 0.20);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < plates; i++) {
      const tx = x - s * 0.48 + i * (s * 0.96) / plates;
      ctx.fillRect(tx, y - s * 0.13, s * 0.005, s * 0.20);
    }

    // Drive sprocket (rear)
    this.drawSprocket(ctx, x - s * 0.42, y - s * 0.03, s * 0.075, this.wheelRot);
    // Idler (front)
    this.drawSprocket(ctx, x + s * 0.42, y - s * 0.03, s * 0.075, this.wheelRot);

    // Road wheels
    ctx.fillStyle = '#383838';
    ctx.strokeStyle = '#5a5a5a';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const wx = x - s * 0.30 + i * s * 0.15;
      ctx.beginPath();
      ctx.arc(wx, y + s * 0.025, s * 0.038, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#5a5a5a';
      ctx.beginPath();
      ctx.arc(wx, y + s * 0.025, s * 0.012, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#383838';
    }

    // Undercarriage frame above tracks
    ctx.fillStyle = '#9c6a1a';
    this.roundRect(ctx, x - s * 0.46, y - s * 0.18, s * 0.92, s * 0.05, s * 0.02);
    ctx.fill();
    ctx.strokeStyle = '#6e4810';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawSprocket(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number) {
    ctx.fillStyle = '#383838';
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Teeth
    ctx.fillStyle = '#1a1a1a';
    for (let i = 0; i < 9; i++) {
      const a = rot + (i / 9) * Math.PI * 2;
      const tx = cx + Math.cos(a) * r * 1.05;
      const ty = cy + Math.sin(a) * r * 1.05;
      ctx.beginPath();
      ctx.arc(tx, ty, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
    // Hub
    ctx.fillStyle = '#5a5a5a';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawHouse(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    // Slewing ring (the disc the cab rotates on)
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.ellipse(x, y - s * 0.18, s * 0.18, s * 0.028, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a4a4a';
    ctx.beginPath();
    ctx.ellipse(x, y - s * 0.20, s * 0.16, s * 0.024, 0, 0, Math.PI * 2);
    ctx.fill();

    // Counterweight (rear, rounded)
    const cwGrad = ctx.createLinearGradient(x - s * 0.32, y - s * 0.46, x - s * 0.10, y - s * 0.20);
    cwGrad.addColorStop(0, '#ffc966');
    cwGrad.addColorStop(1, '#d68b1a');
    ctx.fillStyle = cwGrad;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.32, y - s * 0.20);
    ctx.lineTo(x - s * 0.32, y - s * 0.40);
    ctx.quadraticCurveTo(x - s * 0.32, y - s * 0.48, x - s * 0.24, y - s * 0.48);
    ctx.lineTo(x - s * 0.10, y - s * 0.48);
    ctx.lineTo(x - s * 0.10, y - s * 0.20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#7a4f10';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Counterweight grille
    ctx.strokeStyle = '#7a4f10';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      const gx = x - s * 0.30 + i * s * 0.04;
      ctx.beginPath();
      ctx.moveTo(gx, y - s * 0.42);
      ctx.lineTo(gx, y - s * 0.22);
      ctx.stroke();
    }

    // Cab (front, with sloped top)
    const cabGrad = ctx.createLinearGradient(x - s * 0.10, y - s * 0.48, x + s * 0.24, y - s * 0.20);
    cabGrad.addColorStop(0, '#ffd084');
    cabGrad.addColorStop(1, '#e89a30');
    ctx.fillStyle = cabGrad;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.10, y - s * 0.20);
    ctx.lineTo(x - s * 0.10, y - s * 0.48);
    ctx.lineTo(x + s * 0.20, y - s * 0.48);
    ctx.lineTo(x + s * 0.24, y - s * 0.40);
    ctx.lineTo(x + s * 0.24, y - s * 0.20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#9c6a1a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Door seam
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.04, y - s * 0.20);
    ctx.lineTo(x - s * 0.04, y - s * 0.42);
    ctx.stroke();

    // Cab window (large wraparound)
    ctx.fillStyle = '#cce8ff';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.06, y - s * 0.44);
    ctx.lineTo(x + s * 0.18, y - s * 0.44);
    ctx.lineTo(x + s * 0.21, y - s * 0.39);
    ctx.lineTo(x + s * 0.21, y - s * 0.24);
    ctx.lineTo(x - s * 0.06, y - s * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#9c6a1a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Window glass highlight (diagonal)
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.04, y - s * 0.42);
    ctx.lineTo(x + s * 0.02, y - s * 0.42);
    ctx.lineTo(x - s * 0.04, y - s * 0.30);
    ctx.closePath();
    ctx.fill();

    // Window pillar
    ctx.strokeStyle = '#9c6a1a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.07, y - s * 0.44);
    ctx.lineTo(x + s * 0.07, y - s * 0.24);
    ctx.stroke();

    // Exhaust stack
    ctx.fillStyle = '#222';
    ctx.fillRect(x - s * 0.06, y - s * 0.56, s * 0.035, s * 0.10);
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.arc(x - s * 0.043, y - s * 0.56, s * 0.025, 0, Math.PI * 2);
    ctx.fill();
    // Heat shield
    ctx.fillStyle = '#666';
    ctx.fillRect(x - s * 0.07, y - s * 0.50, s * 0.055, s * 0.012);

    // Branding
    ctx.fillStyle = 'rgba(40,20,5,0.65)';
    ctx.font = `bold ${Math.round(s * 0.045)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('DIG', x - s * 0.22, y - s * 0.28);

    // Light on cab front
    ctx.fillStyle = '#fffbcc';
    ctx.beginPath();
    ctx.arc(x + s * 0.22, y - s * 0.42, s * 0.015, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawArm(ctx: CanvasRenderingContext2D) {
    const s = this.scale;
    const sh = this.getShoulderPos();
    const be = this.getBoomEnd();
    const bp = this.getBucketPivot();

    // Boom hydraulic ram (cab top → top of boom)
    const ramStart = { x: this.x + s * 0.0, y: this.y - s * 0.46 };
    const ramEnd = {
      x: sh.x + (be.x - sh.x) * 0.42 + Math.cos(this.boomAngle - Math.PI / 2) * s * 0.08,
      y: sh.y + (be.y - sh.y) * 0.42 + Math.sin(this.boomAngle - Math.PI / 2) * s * 0.08,
    };
    this.drawHydraulic(ctx, ramStart.x, ramStart.y, ramEnd.x, ramEnd.y, s * 0.026);

    // Boom (curved, tapered)
    this.drawBoom(ctx, sh.x, sh.y, be.x, be.y, s);

    // Stick hydraulic ram (top of boom → top of stick)
    const stickRamStart = {
      x: sh.x + (be.x - sh.x) * 0.78 + Math.cos(this.boomAngle - Math.PI / 2) * s * 0.06,
      y: sh.y + (be.y - sh.y) * 0.78 + Math.sin(this.boomAngle - Math.PI / 2) * s * 0.06,
    };
    const stickRamEnd = {
      x: be.x + (bp.x - be.x) * 0.18 + Math.cos(this.stickAngle - Math.PI / 2) * s * 0.05,
      y: be.y + (bp.y - be.y) * 0.18 + Math.sin(this.stickAngle - Math.PI / 2) * s * 0.05,
    };
    this.drawHydraulic(ctx, stickRamStart.x, stickRamStart.y, stickRamEnd.x, stickRamEnd.y, s * 0.022);

    // Stick
    this.drawStick(ctx, be.x, be.y, bp.x, bp.y, s);

    // Bucket curl ram (middle of stick → bucket linkage)
    const total = this.stickAngle + this.bucketAngle;
    const linkX = bp.x + Math.cos(total - Math.PI / 2) * s * 0.06;
    const linkY = bp.y + Math.sin(total - Math.PI / 2) * s * 0.06;
    const curlRamStart = {
      x: be.x + (bp.x - be.x) * 0.55 + Math.cos(this.stickAngle - Math.PI / 2) * s * 0.05,
      y: be.y + (bp.y - be.y) * 0.55 + Math.sin(this.stickAngle - Math.PI / 2) * s * 0.05,
    };
    this.drawHydraulic(ctx, curlRamStart.x, curlRamStart.y, linkX, linkY, s * 0.018);

    // Joint pins
    this.drawJointPin(ctx, sh.x, sh.y, s * 0.035);
    this.drawJointPin(ctx, be.x, be.y, s * 0.030);

    // Bucket
    this.drawBucket(ctx, bp.x, bp.y, total, s);
    this.drawJointPin(ctx, bp.x, bp.y, s * 0.025);
  }

  private drawBoom(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, s: number) {
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;

    const w1 = s * 0.085;
    const w2 = s * 0.055;
    const arc = s * 0.10;

    const grad = ctx.createLinearGradient(x1 - nx * w1, y1 - ny * w1, x1 + nx * w1, y1 + ny * w1);
    grad.addColorStop(0, '#ffd084');
    grad.addColorStop(1, '#d68b1a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x1 - nx * w1, y1 - ny * w1);
    const ctrlX = x1 + dx * 0.5 - nx * (w1 + arc);
    const ctrlY = y1 + dy * 0.5 - ny * (w1 + arc);
    ctx.quadraticCurveTo(ctrlX, ctrlY, x2 - nx * w2, y2 - ny * w2);
    ctx.lineTo(x2 + nx * w2, y2 + ny * w2);
    ctx.lineTo(x1 + nx * w1, y1 + ny * w1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#7a4f10';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Side panel highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1 - nx * w1 * 0.6, y1 - ny * w1 * 0.6);
    ctx.quadraticCurveTo(ctrlX + nx * w1 * 0.3, ctrlY + ny * w1 * 0.3, x2 - nx * w2 * 0.6, y2 - ny * w2 * 0.6);
    ctx.stroke();
  }

  private drawStick(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, s: number) {
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;

    const w = s * 0.045;
    const grad = ctx.createLinearGradient(x1 - nx * w, y1 - ny * w, x1 + nx * w, y1 + ny * w);
    grad.addColorStop(0, '#ffd084');
    grad.addColorStop(1, '#d68b1a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x1 - nx * w, y1 - ny * w);
    ctx.lineTo(x2 - nx * w * 0.65, y2 - ny * w * 0.65);
    ctx.lineTo(x2 + nx * w * 0.65, y2 + ny * w * 0.65);
    ctx.lineTo(x1 + nx * w, y1 + ny * w);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#7a4f10';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Mounting bracket on top for hydraulic
    ctx.fillStyle = '#5a3a10';
    const bx = x1 + ux * L * 0.55 - nx * w;
    const by = y1 + uy * L * 0.55 - ny * w;
    ctx.fillRect(bx - 3, by - 3, 6, 6);
  }

  private drawHydraulic(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, t: number) {
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    if (L < 1) return;
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;

    const cylLen = L * 0.55;
    const grad = ctx.createLinearGradient(x1 - nx * t, y1 - ny * t, x1 + nx * t, y1 + ny * t);
    grad.addColorStop(0, '#888');
    grad.addColorStop(0.5, '#bbb');
    grad.addColorStop(1, '#555');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x1 - nx * t, y1 - ny * t);
    ctx.lineTo(x1 + ux * cylLen - nx * t, y1 + uy * cylLen - ny * t);
    ctx.lineTo(x1 + ux * cylLen + nx * t, y1 + uy * cylLen + ny * t);
    ctx.lineTo(x1 + nx * t, y1 + ny * t);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Piston rod (silvery)
    const rodT = t * 0.45;
    ctx.fillStyle = '#dcdcdc';
    ctx.beginPath();
    ctx.moveTo(x1 + ux * cylLen - nx * rodT, y1 + uy * cylLen - ny * rodT);
    ctx.lineTo(x2 - nx * rodT, y2 - ny * rodT);
    ctx.lineTo(x2 + nx * rodT, y2 + ny * rodT);
    ctx.lineTo(x1 + ux * cylLen + nx * rodT, y1 + uy * cylLen + ny * rodT);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.stroke();

    // End mounts
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(x1, y1, t * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x2, y2, t * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawJointPin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#bbb';
    ctx.beginPath();
    ctx.arc(x - r * 0.18, y - r * 0.18, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBucket(ctx: CanvasRenderingContext2D, px: number, py: number, angle: number, s: number) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    // Local frame: pin at origin (0,0). +X = forward (toward teeth). +Y = down (into bucket).
    // Body is a near-symmetric C-shape opening upward with pin slightly toward the back-top.
    const w = s * BUCKET_LEN;
    const h = s * 0.20;

    // Pin bracket — small ear above the body that anchors to the stick pin.
    ctx.fillStyle = '#3a3a3a';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-w * 0.06, h * 0.07);
    ctx.lineTo(w * 0.08, h * 0.07);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Body — a real excavator scoop, opening on top, curved bottom, teeth on the front lip.
    // Both back wall and front wall reach the bucket floor so the shape reads symmetric.
    const bodyGrad = ctx.createLinearGradient(0, h * 0.05, 0, h * 1.05);
    bodyGrad.addColorStop(0, '#8a8a8a');
    bodyGrad.addColorStop(0.5, '#5a5a5a');
    bodyGrad.addColorStop(1, '#2e2e2e');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    // Top-back of opening
    ctx.moveTo(-w * 0.30, h * 0.07);
    // Top edge of opening, going forward
    ctx.lineTo(w * 0.82, h * 0.07);
    // Front-upper curve outward
    ctx.quadraticCurveTo(w * 1.00, h * 0.18, w * 0.98, h * 0.55);
    // Front wall down to cutting edge
    ctx.lineTo(w * 0.92, h * 0.92);
    // Front-bottom corner
    ctx.quadraticCurveTo(w * 0.78, h * 1.04, w * 0.50, h * 1.04);
    // Bottom (slight curve, deeper in middle)
    ctx.quadraticCurveTo(w * 0.20, h * 1.06, -w * 0.05, h * 1.02);
    // Back-bottom corner
    ctx.quadraticCurveTo(-w * 0.26, h * 0.96, -w * 0.32, h * 0.78);
    // Back wall up
    ctx.lineTo(-w * 0.30, h * 0.07);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inside cavity — darker inset showing the bucket is a hollow scoop.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.22, h * 0.14);
    ctx.lineTo(w * 0.74, h * 0.14);
    ctx.quadraticCurveTo(w * 0.86, h * 0.22, w * 0.84, h * 0.55);
    ctx.lineTo(w * 0.78, h * 0.85);
    ctx.quadraticCurveTo(w * 0.55, h * 0.95, w * 0.20, h * 0.95);
    ctx.quadraticCurveTo(-w * 0.05, h * 0.92, -w * 0.20, h * 0.85);
    ctx.quadraticCurveTo(-w * 0.26, h * 0.62, -w * 0.22, h * 0.14);
    ctx.closePath();
    ctx.fill();

    // Material fill — visible load when carrying.
    if (this.fill > 0 && !this.dumping) {
      const fillH = h * 0.7 * Math.min(1, this.fill);
      const top = h * 0.88 - fillH;
      const colors = this.fillMaterial === 'rock'
        ? ['#6a6560', '#8a8580']
        : this.fillMaterial === 'clay'
        ? ['#8a4f20', '#a86a3a']
        : ['#6e4810', '#9c6a1a'];
      ctx.fillStyle = colors[0];
      ctx.beginPath();
      ctx.moveTo(-w * 0.20, top + 4);
      const segs = 8;
      for (let i = 1; i <= segs; i++) {
        const fx = -w * 0.20 + (w * 0.94) * (i / segs);
        const bump = Math.sin(i * 1.7 + this.idle * 0.6) * 1.5;
        ctx.lineTo(fx, top + bump);
      }
      ctx.lineTo(w * 0.74, h * 0.88);
      ctx.quadraticCurveTo(w * 0.40, h * 0.95, -w * 0.16, h * 0.88);
      ctx.closePath();
      ctx.fill();
      // Lighter dust band on top of the load
      ctx.fillStyle = colors[1];
      ctx.beginPath();
      ctx.moveTo(-w * 0.20, top + 4);
      for (let i = 1; i <= segs; i++) {
        const fx = -w * 0.20 + (w * 0.94) * (i / segs);
        const bump = Math.sin(i * 1.7 + this.idle * 0.6) * 1.5;
        ctx.lineTo(fx, top + bump);
      }
      ctx.lineTo(w * 0.74, top + 6);
      ctx.lineTo(-w * 0.20, top + 6);
      ctx.closePath();
      ctx.fill();
    }

    // Cutting-edge wear band (lighter strip along the front lip)
    ctx.strokeStyle = '#9a9a9a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w * 0.05, h * 1.02);
    ctx.quadraticCurveTo(w * 0.40, h * 1.07, w * 0.85, h * 0.96);
    ctx.stroke();

    // Teeth — 5 along the cutting edge, base width modest, length ≈ h*0.18.
    ctx.fillStyle = '#d4d4d4';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.2;
    const teethN = 5;
    const teethStart = -w * 0.02;
    const teethEnd = w * 0.78;
    for (let i = 0; i < teethN; i++) {
      const t = i / (teethN - 1);
      const tx = teethStart + (teethEnd - teethStart) * t;
      // Base sits on the cutting edge — slight arc following the lip.
      const ty = h * 1.04 + (1 - 4 * Math.pow(t - 0.5, 2)) * h * 0.02 - Math.abs(t - 0.5) * h * 0.03;
      const baseHalf = w * 0.028;
      const tipLen = h * 0.18;
      ctx.beginPath();
      ctx.moveTo(tx - baseHalf, ty);
      ctx.lineTo(tx, ty + tipLen);
      ctx.lineTo(tx + baseHalf, ty);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Side rib detail (panels on outer face)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.10, h * 0.10);
    ctx.lineTo(w * 0.13, h * 0.85);
    ctx.moveTo(w * 0.45, h * 0.07);
    ctx.lineTo(w * 0.50, h * 0.95);
    ctx.stroke();

    // Mounting boss highlight where the curl link attaches (back-top)
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(-w * 0.18, h * 0.11, w * 0.018, 0, Math.PI * 2);
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
