import type { FrameContext, Scene } from '../types';

// Minimal excavator placeholder so the scaffold is interactive on day one.
// Drag anywhere to raise/lower the arm. Replace with the real game progressively.
export class ExcavatorScene implements Scene {
  private armAngle = -0.4; // radians, negative = arm raised
  private targetArmAngle = -0.4;
  private bucketAngle = 0.6;
  private cabX = 0; // anchor in world units (0..1 along ground)

  update({ pointers, dt, width, height, orientation }: FrameContext) {
    // Drag controls arm angle. Vertical drag from anywhere on screen.
    const first = pointers.values().next().value;
    if (first?.down) {
      const portrait = orientation === 'portrait';
      const range = portrait ? height * 0.6 : height * 0.7;
      const norm = (first.y - height * 0.2) / range; // 0 top .. 1 bottom
      this.targetArmAngle = -1.0 + Math.max(0, Math.min(1, norm)) * 1.4;
      this.bucketAngle = 0.3 + Math.max(0, Math.min(1, norm)) * 0.8;
    } else {
      // Slow drift back toward neutral so it never sits dead-still
      this.targetArmAngle += Math.sin(performance.now() / 1500) * 0.0008;
    }
    // Smooth ease toward target
    const k = 1 - Math.pow(0.001, dt);
    this.armAngle += (this.targetArmAngle - this.armAngle) * k;

    // Idle sway of the cab so the screen feels alive
    this.cabX = 0.5 + Math.sin(performance.now() / 2400) * 0.02;
    void width;
  }

  render({ ctx, width, height, orientation }: FrameContext) {
    const portrait = orientation === 'portrait';
    const horizonY = portrait ? height * 0.55 : height * 0.65;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, '#9ad8ff');
    sky.addColorStop(1, '#d8efff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizonY);

    // Sun
    ctx.fillStyle = '#ffe680';
    ctx.beginPath();
    ctx.arc(width * 0.85, height * 0.18, Math.min(width, height) * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // Ground
    const ground = ctx.createLinearGradient(0, horizonY, 0, height);
    ground.addColorStop(0, '#caa472');
    ground.addColorStop(1, '#8a6a3f');
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizonY, width, height - horizonY);

    // Dirt mound
    ctx.fillStyle = '#7a5a30';
    ctx.beginPath();
    ctx.ellipse(width * 0.78, horizonY + 18, width * 0.18, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    // Excavator
    const scale = Math.min(width, height) * (portrait ? 0.55 : 0.4);
    const baseX = width * this.cabX;
    const baseY = horizonY + 4;
    this.drawExcavator(ctx, baseX, baseY, scale);

    // HUD hint (tiny, won't dominate)
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = `${Math.round(Math.min(width, height) * 0.022)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('drag up & down', width / 2, height - 14);
  }

  private drawExcavator(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    // Tracks
    ctx.fillStyle = '#2c2c2c';
    ctx.beginPath();
    ctx.roundRect(x - s * 0.5, y - s * 0.12, s, s * 0.18, s * 0.06);
    ctx.fill();
    // Track wheels
    ctx.fillStyle = '#444';
    for (let i = 0; i < 5; i++) {
      const wx = x - s * 0.4 + i * (s * 0.2);
      ctx.beginPath();
      ctx.arc(wx, y - s * 0.03, s * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cab body
    ctx.fillStyle = '#ffb84d';
    ctx.beginPath();
    ctx.roundRect(x - s * 0.32, y - s * 0.42, s * 0.55, s * 0.32, s * 0.05);
    ctx.fill();
    // Cab window
    ctx.fillStyle = '#a9d6ff';
    ctx.beginPath();
    ctx.roundRect(x - s * 0.26, y - s * 0.38, s * 0.28, s * 0.18, s * 0.03);
    ctx.fill();

    // Boom (upper arm) — pivots at shoulder
    const shoulderX = x + s * 0.12;
    const shoulderY = y - s * 0.32;
    const boomLen = s * 0.55;
    const boomEndX = shoulderX + Math.cos(this.armAngle) * boomLen;
    const boomEndY = shoulderY + Math.sin(this.armAngle) * boomLen;
    ctx.strokeStyle = '#ffb84d';
    ctx.lineWidth = s * 0.08;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(boomEndX, boomEndY);
    ctx.stroke();

    // Stick (lower arm)
    const stickLen = s * 0.4;
    const stickAngle = this.armAngle + 0.9;
    const stickEndX = boomEndX + Math.cos(stickAngle) * stickLen;
    const stickEndY = boomEndY + Math.sin(stickAngle) * stickLen;
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.moveTo(boomEndX, boomEndY);
    ctx.lineTo(stickEndX, stickEndY);
    ctx.stroke();

    // Bucket
    ctx.fillStyle = '#444';
    ctx.save();
    ctx.translate(stickEndX, stickEndY);
    ctx.rotate(stickAngle + this.bucketAngle);
    ctx.beginPath();
    ctx.moveTo(-s * 0.04, 0);
    ctx.lineTo(s * 0.16, 0);
    ctx.lineTo(s * 0.12, s * 0.14);
    ctx.lineTo(0, s * 0.16);
    ctx.closePath();
    ctx.fill();
    // Teeth
    ctx.fillStyle = '#888';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s * 0.04, s * 0.16);
      ctx.lineTo(i * s * 0.04 + s * 0.02, s * 0.2);
      ctx.lineTo(i * s * 0.04 + s * 0.04, s * 0.16);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
