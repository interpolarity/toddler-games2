// Layered parallax background: sky gradient, sun glow, drifting clouds, two layers of hills.

interface Cloud { x: number; y: number; size: number; drift: number; }
interface Hill { x: number; y: number; w: number; h: number; color: string; shadow: string; }

export class Background {
  width: number;
  height: number;
  horizonY: number;
  clouds: Cloud[] = [];
  hillsFar: Hill[] = [];
  hillsNear: Hill[] = [];

  constructor(width: number, height: number, horizonY: number) {
    this.width = width;
    this.height = height;
    this.horizonY = horizonY;
    this.populate();
  }

  resize(width: number, height: number, horizonY: number) {
    this.width = width;
    this.height = height;
    this.horizonY = horizonY;
    this.populate();
  }

  private populate() {
    this.clouds.length = 0;
    const cloudCount = Math.max(4, Math.floor(this.width / 220));
    for (let i = 0; i < cloudCount; i++) {
      this.clouds.push({
        x: Math.random() * this.width,
        y: 30 + Math.random() * (this.horizonY * 0.55),
        size: 36 + Math.random() * 60,
        drift: 4 + Math.random() * 7,
      });
    }

    this.hillsFar.length = 0;
    this.hillsNear.length = 0;
    const farCount = Math.max(3, Math.floor(this.width / 260));
    const nearCount = Math.max(3, Math.floor(this.width / 320));
    for (let i = 0; i < farCount; i++) {
      const w = 200 + Math.random() * 140;
      const h = 60 + Math.random() * 50;
      this.hillsFar.push({
        x: -50 + (this.width + 100) * (i / Math.max(1, farCount - 0.5)) - w * 0.3,
        y: this.horizonY - h * 0.85,
        w,
        h,
        color: '#a8c2a4',
        shadow: '#90ad8d',
      });
    }
    for (let i = 0; i < nearCount; i++) {
      const w = 240 + Math.random() * 180;
      const h = 50 + Math.random() * 40;
      this.hillsNear.push({
        x: -60 + (this.width + 120) * (i / Math.max(1, nearCount - 0.5)) - w * 0.4,
        y: this.horizonY - h * 0.7,
        w,
        h,
        color: '#7e9a78',
        shadow: '#658060',
      });
    }
  }

  update(dt: number) {
    for (const c of this.clouds) {
      c.x += c.drift * dt;
      if (c.x - c.size > this.width) c.x = -c.size;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Sky gradient (top to horizon)
    const sky = ctx.createLinearGradient(0, 0, 0, this.horizonY);
    sky.addColorStop(0, '#73b6e3');
    sky.addColorStop(0.55, '#a8d6ee');
    sky.addColorStop(1, '#dcefee');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.width, this.horizonY);

    // Sun + glow
    const sunX = this.width * 0.82;
    const sunY = this.horizonY * 0.28;
    const sunR = Math.min(this.width, this.height) * 0.05;
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3.2);
    glow.addColorStop(0, 'rgba(255,238,170,0.85)');
    glow.addColorStop(0.4, 'rgba(255,238,170,0.25)');
    glow.addColorStop(1, 'rgba(255,238,170,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - sunR * 3.5, sunY - sunR * 3.5, sunR * 7, sunR * 7);
    ctx.fillStyle = '#fff5b0';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    // Clouds
    for (const c of this.clouds) {
      this.drawCloud(ctx, c);
    }

    // Far hills
    for (const h of this.hillsFar) this.drawHill(ctx, h, true);
    // Near hills
    for (const h of this.hillsNear) this.drawHill(ctx, h, false);

    // Distant tree line silhouettes on near hills
    ctx.fillStyle = '#5d7a58';
    for (const h of this.hillsNear) {
      const baseY = h.y + h.h * 0.3;
      for (let i = 0; i < 6; i++) {
        const tx = h.x + h.w * (0.15 + 0.13 * i + Math.sin(i * 1.7) * 0.04);
        const tH = 8 + (i % 3) * 4;
        if (tx > 0 && tx < this.width) {
          ctx.beginPath();
          ctx.arc(tx, baseY, tH * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private drawHill(ctx: CanvasRenderingContext2D, h: Hill, far: boolean) {
    ctx.fillStyle = h.color;
    ctx.beginPath();
    ctx.moveTo(h.x, h.y + h.h);
    ctx.quadraticCurveTo(h.x + h.w * 0.5, h.y - h.h * 0.05, h.x + h.w, h.y + h.h);
    ctx.lineTo(h.x + h.w, this.horizonY + 4);
    ctx.lineTo(h.x, this.horizonY + 4);
    ctx.closePath();
    ctx.fill();

    // Shadow underside
    ctx.fillStyle = h.shadow;
    ctx.beginPath();
    ctx.moveTo(h.x, h.y + h.h);
    ctx.quadraticCurveTo(h.x + h.w * 0.6, h.y + h.h * 0.4, h.x + h.w, h.y + h.h);
    ctx.lineTo(h.x + h.w, this.horizonY + 4);
    ctx.lineTo(h.x, this.horizonY + 4);
    ctx.closePath();
    ctx.fill();

    // Highlight side
    if (!far) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(h.x + h.w * 0.1, h.y + h.h * 0.7);
      ctx.quadraticCurveTo(h.x + h.w * 0.45, h.y + h.h * 0.05, h.x + h.w * 0.7, h.y + h.h * 0.4);
      ctx.stroke();
    }
  }

  private drawCloud(ctx: CanvasRenderingContext2D, c: Cloud) {
    const r = c.size * 0.5;
    const grad = ctx.createRadialGradient(c.x + r * 0.3, c.y - r * 0.2, r * 0.2, c.x + r * 0.3, c.y, r * 1.4);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0.7)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 0.9, 0, Math.PI * 2);
    ctx.arc(c.x + r * 0.7, c.y - r * 0.2, r * 0.85, 0, Math.PI * 2);
    ctx.arc(c.x + r * 1.3, c.y, r * 0.95, 0, Math.PI * 2);
    ctx.arc(c.x + r * 0.4, c.y + r * 0.25, r * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
}
