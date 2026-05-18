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
    // Sago-style tracks: solid dark-brown chassis, three big rounded wheels
    // with cream hubs, a handful of chunky cleats, thick outlines, no gradients.
    const stroke = '#3a1808';

    // Track frame (rounded slab)
    ctx.fillStyle = '#3a2818';
    this.roundRect(ctx, x - s * 0.52, y - s * 0.15, s * 1.04, s * 0.24, s * 0.10);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.022;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Track top deck — thin warm-orange strip so the body line reads.
    ctx.fillStyle = '#d68a2a';
    this.roundRect(ctx, x - s * 0.50, y - s * 0.18, s * 1.0, s * 0.06, s * 0.025);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.020;
    ctx.stroke();

    // Big chunky cleats — just six of them so the eye reads "tracked vehicle"
    // without the busy 16-plate grouser pattern.
    ctx.fillStyle = '#1a0e04';
    const cleatN = 6;
    for (let i = 0; i < cleatN; i++) {
      const tx = x - s * 0.45 + i * (s * 0.9) / (cleatN - 1) - s * 0.025;
      this.roundRect(ctx, tx, y - s * 0.12, s * 0.05, s * 0.20, s * 0.022);
      ctx.fill();
    }

    // Wheels: drive sprocket (rear), idler (front), and two road wheels
    // between them. Each is a flat circle with cream hub and a single spoke
    // line that rotates with the vehicle.
    const wheelR = s * 0.085;
    const wheelY = y - s * 0.02;
    const wheelXs = [-0.42, -0.14, 0.14, 0.42];
    for (const wx of wheelXs) {
      this.drawSagoWheel(ctx, x + s * wx, wheelY, wheelR, this.wheelRot, stroke);
    }
  }

  private drawSagoWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number, stroke: string) {
    // Outer tire
    ctx.fillStyle = '#1a0e04';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = r * 0.30;
    ctx.stroke();
    // Hub (cream)
    ctx.fillStyle = '#fff5d8';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = r * 0.22;
    ctx.stroke();
    // Single spoke that rotates so motion reads
    ctx.strokeStyle = stroke;
    ctx.lineWidth = r * 0.18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rot) * r * 0.30, cy + Math.sin(rot) * r * 0.30);
    ctx.lineTo(cx - Math.cos(rot) * r * 0.30, cy - Math.sin(rot) * r * 0.30);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  private drawHouse(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    const stroke = '#3a1808';
    const bodyMain = '#f5b04a';
    const bodyShadow = '#d68a2a';

    // Slewing ring — flat dark disc.
    ctx.fillStyle = '#1a0e04';
    ctx.beginPath();
    ctx.ellipse(x, y - s * 0.20, s * 0.20, s * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.018;
    ctx.stroke();

    // House — combined counterweight + cab as one chunky orange shape with
    // rounded top corners, then a darker amber band along the bottom for
    // depth (flat shape, not gradient).
    ctx.fillStyle = bodyMain;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.34, y - s * 0.20);
    ctx.lineTo(x - s * 0.34, y - s * 0.44);
    ctx.quadraticCurveTo(x - s * 0.34, y - s * 0.50, x - s * 0.27, y - s * 0.50);
    ctx.lineTo(x + s * 0.18, y - s * 0.50);
    ctx.quadraticCurveTo(x + s * 0.26, y - s * 0.50, x + s * 0.28, y - s * 0.42);
    ctx.lineTo(x + s * 0.28, y - s * 0.20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.026;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Bottom shadow band (flat lower stripe of darker amber)
    ctx.fillStyle = bodyShadow;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.34, y - s * 0.27);
    ctx.lineTo(x + s * 0.28, y - s * 0.27);
    ctx.lineTo(x + s * 0.28, y - s * 0.20);
    ctx.lineTo(x - s * 0.34, y - s * 0.20);
    ctx.closePath();
    ctx.fill();

    // Re-outline the house perimeter so the shadow band doesn't bleed.
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.026;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.34, y - s * 0.20);
    ctx.lineTo(x - s * 0.34, y - s * 0.44);
    ctx.quadraticCurveTo(x - s * 0.34, y - s * 0.50, x - s * 0.27, y - s * 0.50);
    ctx.lineTo(x + s * 0.18, y - s * 0.50);
    ctx.quadraticCurveTo(x + s * 0.26, y - s * 0.50, x + s * 0.28, y - s * 0.42);
    ctx.lineTo(x + s * 0.28, y - s * 0.20);
    ctx.closePath();
    ctx.stroke();

    // Window — big rounded square of pale blue with a single white highlight.
    ctx.fillStyle = '#bce0ff';
    this.roundRect(ctx, x - s * 0.04, y - s * 0.46, s * 0.28, s * 0.22, s * 0.04);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.022;
    ctx.stroke();
    // Single white highlight rectangle inside the window.
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    this.roundRect(ctx, x - s * 0.02, y - s * 0.44, s * 0.07, s * 0.13, s * 0.02);
    ctx.fill();

    // Exhaust stack — chunky cream stack with a dark cap.
    ctx.fillStyle = '#fff5d8';
    this.roundRect(ctx, x - s * 0.10, y - s * 0.58, s * 0.06, s * 0.14, s * 0.018);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.020;
    ctx.stroke();
    ctx.fillStyle = stroke;
    this.roundRect(ctx, x - s * 0.105, y - s * 0.60, s * 0.07, s * 0.025, s * 0.010);
    ctx.fill();

    // Headlamp on cab front.
    ctx.fillStyle = '#fff5b0';
    ctx.beginPath();
    ctx.arc(x + s * 0.26, y - s * 0.38, s * 0.024, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.018;
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
    // Sago-style boom: flat warm-orange tapered shape with thick brown
    // outline and one solid white highlight strip.
    const stroke = '#3a1808';
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;
    const w1 = s * 0.085;
    const w2 = s * 0.060;
    const arc = s * 0.08;
    ctx.fillStyle = '#f5b04a';
    ctx.beginPath();
    ctx.moveTo(x1 - nx * w1, y1 - ny * w1);
    const ctrlX = x1 + dx * 0.5 - nx * (w1 + arc);
    const ctrlY = y1 + dy * 0.5 - ny * (w1 + arc);
    ctx.quadraticCurveTo(ctrlX, ctrlY, x2 - nx * w2, y2 - ny * w2);
    ctx.lineTo(x2 + nx * w2, y2 + ny * w2);
    ctx.lineTo(x1 + nx * w1, y1 + ny * w1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.024;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Single white highlight band on the top edge.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = s * 0.012;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1 - nx * w1 * 0.55, y1 - ny * w1 * 0.55);
    ctx.quadraticCurveTo(ctrlX + nx * w1 * 0.20, ctrlY + ny * w1 * 0.20, x2 - nx * w2 * 0.55, y2 - ny * w2 * 0.55);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  private drawStick(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, s: number) {
    const stroke = '#3a1808';
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;
    const w = s * 0.052;
    ctx.fillStyle = '#f5b04a';
    ctx.beginPath();
    ctx.moveTo(x1 - nx * w, y1 - ny * w);
    ctx.lineTo(x2 - nx * w * 0.65, y2 - ny * w * 0.65);
    ctx.lineTo(x2 + nx * w * 0.65, y2 + ny * w * 0.65);
    ctx.lineTo(x1 + nx * w, y1 + ny * w);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.024;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Top edge highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = s * 0.010;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1 - nx * w * 0.55, y1 - ny * w * 0.55);
    ctx.lineTo(x2 - nx * w * 0.40, y2 - ny * w * 0.40);
    ctx.stroke();
    ctx.lineCap = 'butt';
    void ux; void uy; void L;
  }

  private drawHydraulic(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, t: number) {
    // Sago hydraulic: cream cylinder + cream rod, thick brown outlines,
    // dark pin caps.
    const stroke = '#3a1808';
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    if (L < 1) return;
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;
    const cylLen = L * 0.55;
    // Cylinder body (warmer cream)
    ctx.fillStyle = '#e8d8b8';
    ctx.beginPath();
    ctx.moveTo(x1 - nx * t, y1 - ny * t);
    ctx.lineTo(x1 + ux * cylLen - nx * t, y1 + uy * cylLen - ny * t);
    ctx.lineTo(x1 + ux * cylLen + nx * t, y1 + uy * cylLen + ny * t);
    ctx.lineTo(x1 + nx * t, y1 + ny * t);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = t * 0.45;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Piston rod (lighter cream)
    const rodT = t * 0.45;
    ctx.fillStyle = '#fff5d8';
    ctx.beginPath();
    ctx.moveTo(x1 + ux * cylLen - nx * rodT, y1 + uy * cylLen - ny * rodT);
    ctx.lineTo(x2 - nx * rodT, y2 - ny * rodT);
    ctx.lineTo(x2 + nx * rodT, y2 + ny * rodT);
    ctx.lineTo(x1 + ux * cylLen + nx * rodT, y1 + uy * cylLen + ny * rodT);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = t * 0.35;
    ctx.stroke();
    // Dark pin caps
    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.arc(x1, y1, t * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x2, y2, t * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawJointPin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    // Cream pin with thick brown outline + small dark center dot.
    ctx.fillStyle = '#fff5d8';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a1808';
    ctx.lineWidth = r * 0.45;
    ctx.stroke();
    ctx.fillStyle = '#3a1808';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBucket(ctx: CanvasRenderingContext2D, px: number, py: number, angle: number, s: number) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    // Sago bucket: flat warm-gray scoop with thick brown outline, big cream
    // teeth, and a friendlier (chunkier) silhouette than the realistic one.
    const stroke = '#3a1808';
    const bodyColor = '#7a6a5a';
    const cavityColor = '#3a2818';
    const teethColor = '#fff5d8';
    const w = s * BUCKET_LEN;
    const h = s * 0.20;

    // Pin bracket ear
    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.04);
    ctx.lineTo(-w * 0.07, h * 0.07);
    ctx.lineTo(w * 0.09, h * 0.07);
    ctx.closePath();
    ctx.fill();

    // Body — same C-shape but flat-filled.
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(-w * 0.30, h * 0.07);
    ctx.lineTo(w * 0.82, h * 0.07);
    ctx.quadraticCurveTo(w * 1.00, h * 0.18, w * 0.98, h * 0.55);
    ctx.lineTo(w * 0.92, h * 0.92);
    ctx.quadraticCurveTo(w * 0.78, h * 1.04, w * 0.50, h * 1.04);
    ctx.quadraticCurveTo(w * 0.20, h * 1.06, -w * 0.05, h * 1.02);
    ctx.quadraticCurveTo(-w * 0.26, h * 0.96, -w * 0.32, h * 0.78);
    ctx.lineTo(-w * 0.30, h * 0.07);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.024;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Inside cavity — flat dark inset.
    ctx.fillStyle = cavityColor;
    ctx.beginPath();
    ctx.moveTo(-w * 0.22, h * 0.16);
    ctx.lineTo(w * 0.74, h * 0.16);
    ctx.quadraticCurveTo(w * 0.86, h * 0.24, w * 0.84, h * 0.55);
    ctx.lineTo(w * 0.78, h * 0.85);
    ctx.quadraticCurveTo(w * 0.55, h * 0.94, w * 0.20, h * 0.94);
    ctx.quadraticCurveTo(-w * 0.05, h * 0.92, -w * 0.20, h * 0.85);
    ctx.quadraticCurveTo(-w * 0.26, h * 0.62, -w * 0.22, h * 0.16);
    ctx.closePath();
    ctx.fill();

    // Material fill — flat solid color when carrying (no rolling sine).
    if (this.fill > 0 && !this.dumping) {
      const fillH = h * 0.7 * Math.min(1, this.fill);
      const top = h * 0.88 - fillH;
      const matColor = this.fillMaterial === 'rock'
        ? '#9a8a78'
        : this.fillMaterial === 'clay'
        ? '#b07040'
        : '#a07832';
      ctx.fillStyle = matColor;
      ctx.beginPath();
      ctx.moveTo(-w * 0.20, top);
      ctx.lineTo(w * 0.74, top);
      ctx.lineTo(w * 0.74, h * 0.88);
      ctx.quadraticCurveTo(w * 0.40, h * 0.95, -w * 0.16, h * 0.88);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = s * 0.012;
      ctx.stroke();
    }

    // Teeth — four chunky cream teeth with thick brown outlines.
    const teethN = 4;
    const teethStart = w * 0.05;
    const teethEnd = w * 0.70;
    for (let i = 0; i < teethN; i++) {
      const t = i / (teethN - 1);
      const tx = teethStart + (teethEnd - teethStart) * t;
      const ty = h * 1.02 + (1 - 4 * Math.pow(t - 0.5, 2)) * h * 0.02;
      const baseHalf = w * 0.045;
      const tipLen = h * 0.20;
      ctx.fillStyle = teethColor;
      ctx.beginPath();
      ctx.moveTo(tx - baseHalf, ty);
      ctx.lineTo(tx, ty + tipLen);
      ctx.lineTo(tx + baseHalf, ty);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = s * 0.020;
      ctx.stroke();
    }

    // Single white highlight stroke on the upper-front of the body.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = s * 0.012;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-w * 0.20, h * 0.11);
    ctx.lineTo(w * 0.70, h * 0.11);
    ctx.stroke();
    ctx.lineCap = 'butt';

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
