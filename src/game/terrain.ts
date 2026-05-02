import type { Material } from './excavator';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  settle: boolean; // if true, settles into terrain pile on contact
  material: Material;
}

const CELL = 3;

export class Terrain {
  width: number;
  height: number;
  cells: number;
  surface: Float32Array; // current top y of each cell (smaller y = higher ground)
  original: Float32Array; // original undisturbed surface
  particles: Particle[] = [];

  constructor(width: number, height: number, baseY: number) {
    this.width = width;
    this.height = height;
    this.cells = Math.ceil(width / CELL);
    this.surface = new Float32Array(this.cells);
    this.original = new Float32Array(this.cells);

    // Subtle undulating surface
    for (let i = 0; i < this.cells; i++) {
      const x = i * CELL;
      const noise =
        Math.sin(x * 0.011) * 4 +
        Math.sin(x * 0.037 + 1.3) * 2.5 +
        Math.sin(x * 0.082) * 1.2;
      this.original[i] = baseY + noise;
      this.surface[i] = this.original[i];
    }
  }

  resize(width: number, height: number, baseY: number) {
    this.width = width;
    this.height = height;
    this.cells = Math.ceil(width / CELL);
    this.surface = new Float32Array(this.cells);
    this.original = new Float32Array(this.cells);
    for (let i = 0; i < this.cells; i++) {
      const x = i * CELL;
      const noise =
        Math.sin(x * 0.011) * 4 +
        Math.sin(x * 0.037 + 1.3) * 2.5 +
        Math.sin(x * 0.082) * 1.2;
      this.original[i] = baseY + noise;
      this.surface[i] = this.original[i];
    }
    this.particles.length = 0;
  }

  private materialAtDepth(depth: number): Material {
    if (depth < 35) return 'dirt';
    if (depth < 110) return 'clay';
    return 'rock';
  }

  // Bucket carving. (cx, cy) is the bucket work point, r is the radius.
  // Removes material below the surface within that circle, returns volume + dominant material.
  carve(cx: number, cy: number, r: number, dt: number): { volume: number; material: Material } | null {
    const startCell = Math.max(0, Math.floor((cx - r) / CELL));
    const endCell = Math.min(this.cells - 1, Math.ceil((cx + r) / CELL));
    if (startCell > endCell) return null;

    let totalVolume = 0;
    let depthSum = 0;
    let depthCount = 0;
    const rate = 220 * dt; // px of carve per second

    for (let i = startCell; i <= endCell; i++) {
      const cellX = i * CELL + CELL / 2;
      const dx = cellX - cx;
      const reach = Math.sqrt(Math.max(0, r * r - dx * dx));
      const bucketBottom = cy + reach;
      if (bucketBottom > this.surface[i]) {
        const dig = Math.min(rate, bucketBottom - this.surface[i]);
        if (dig > 0.05) {
          // Spawn small puff at the dig site
          if (Math.random() < 0.4) {
            const depth = this.surface[i] - this.original[i];
            const mat = this.materialAtDepth(Math.max(0, depth));
            this.spawnDigParticle(cellX, this.surface[i], mat);
          }
          this.surface[i] += dig;
          totalVolume += dig * CELL;
          depthSum += this.surface[i] - this.original[i];
          depthCount++;
        }
      }
    }

    if (totalVolume <= 0) return null;
    const avgDepth = depthSum / Math.max(1, depthCount);
    return { volume: totalVolume, material: this.materialAtDepth(Math.max(0, avgDepth)) };
  }

  // Dump material out the bucket — particles fall and accumulate as a pile.
  dump(cx: number, cy: number, totalVolume: number, material: Material) {
    const count = Math.min(80, Math.max(20, Math.floor(totalVolume * 0.04)));
    const colors = this.materialColors(material);
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
      const speed = 70 + Math.random() * 60;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 22,
        y: cy + (Math.random() - 0.5) * 8,
        vx: Math.cos(ang) * speed * 0.3 + (Math.random() - 0.5) * 30,
        vy: Math.sin(ang) * speed * 0.3 + 30 + Math.random() * 50,
        size: 2.5 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 2.5 + Math.random() * 1.5,
        settle: true,
        material,
      });
    }
  }

  private spawnDigParticle(x: number, y: number, mat: Material) {
    const colors = this.materialColors(mat);
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.0;
    const speed = 80 + Math.random() * 80;
    this.particles.push({
      x,
      y: y - 2,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      size: 1.6 + Math.random() * 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 0.6 + Math.random() * 0.5,
      settle: false,
      material: mat,
    });
  }

  private materialColors(mat: Material): string[] {
    if (mat === 'rock') return ['#5a5550', '#777', '#8a8580', '#666'];
    if (mat === 'clay') return ['#8a4f20', '#a86a3a', '#c08850', '#9a5a2a'];
    return ['#6e4810', '#8a5e16', '#a87420', '#9c6a1a'];
  }

  update(dt: number) {
    const g = 600;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += g * dt;
      p.vx *= Math.pow(0.5, dt);
      p.life -= dt;

      if (p.settle) {
        const cell = Math.floor(p.x / CELL);
        if (cell >= 0 && cell < this.cells && p.y >= this.surface[cell]) {
          // Pile on top: raise surface (smaller y) by a small amount
          this.surface[cell] -= 0.6;
          // Cap pile height
          const maxPile = this.original[cell] - 70;
          if (this.surface[cell] < maxPile) this.surface[cell] = maxPile;
          // Smooth into neighbors so piles aren't single-column spikes
          if (cell > 0 && this.surface[cell - 1] - this.surface[cell] > 4) {
            this.surface[cell - 1] -= 0.3;
          }
          if (cell < this.cells - 1 && this.surface[cell + 1] - this.surface[cell] > 4) {
            this.surface[cell + 1] -= 0.3;
          }
          this.particles.splice(i, 1);
          continue;
        }
      }

      if (p.life <= 0 || p.y > this.height + 50 || p.x < -20 || p.x > this.width + 20) {
        this.particles.splice(i, 1);
      }
    }
    if (this.particles.length > 350) {
      this.particles.splice(0, this.particles.length - 350);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Strategy: every cell draws its FULL substrate column from origY down to the
    // bottom of the canvas, regardless of whether it's been dug. Then a hole-shadow
    // overlay darkens the air space in dug cells, and pile material covers the
    // surface in piled cells. This way there are no gaps in coverage and the dug
    // area shows the layered cross-section "behind" the hole.
    for (let i = 0; i < this.cells; i++) {
      const x = i * CELL;
      const surfY = this.surface[i];
      const origY = this.original[i];
      const dug = surfY > origY + 0.5;
      const piled = surfY < origY - 0.5;

      // 1. Substrate column (intact appearance)
      // Grass + topsoil cap at origY
      ctx.fillStyle = '#5a8a36';
      ctx.fillRect(x, origY - 4, CELL, 4);
      ctx.fillStyle = '#3a6620';
      ctx.fillRect(x, origY, CELL, 2);
      ctx.fillStyle = '#5a3010';
      ctx.fillRect(x, origY + 2, CELL, 4);

      // Dirt
      const dirtTop = origY + 6;
      const dirtBot = Math.min(this.height, origY + 35);
      if (dirtBot > dirtTop) {
        ctx.fillStyle = '#8a5e16';
        ctx.fillRect(x, dirtTop, CELL, dirtBot - dirtTop);
        if ((i % 11) === 3) {
          ctx.fillStyle = '#6e4810';
          ctx.fillRect(x, dirtTop + 4, CELL, 2);
        }
        if ((i % 19) === 7) {
          ctx.fillStyle = '#a87420';
          ctx.fillRect(x, dirtTop + 14, 2, 2);
        }
      }
      // Clay
      const clayBot = Math.min(this.height, origY + 110);
      if (clayBot > dirtBot) {
        ctx.fillStyle = '#a86a3a';
        ctx.fillRect(x, dirtBot, CELL, clayBot - dirtBot);
        if ((i % 13) === 4) {
          ctx.fillStyle = '#8a4f20';
          ctx.fillRect(x, dirtBot + 18, CELL, 3);
        }
        if ((i % 17) === 9) {
          ctx.fillStyle = '#c08850';
          ctx.fillRect(x, dirtBot + 38, 2, 2);
        }
      }
      // Rock
      if (this.height > clayBot) {
        ctx.fillStyle = '#5a5550';
        ctx.fillRect(x, clayBot, CELL, this.height - clayBot);
        if ((i % 9) === 5) {
          ctx.fillStyle = '#888';
          ctx.fillRect(x, clayBot + 14 + (i % 5) * 9, 2, 2);
        }
        if ((i % 23) === 11) {
          ctx.fillStyle = '#3a3530';
          ctx.fillRect(x, clayBot + 32, CELL, 3);
        }
      }

      // 2. Hole shadow — darken the dug-out region so it reads as a depression.
      // Draws on top of the substrate so the layers are visible "through" the hole.
      if (dug) {
        const grad = ctx.createLinearGradient(0, origY, 0, surfY);
        grad.addColorStop(0, 'rgba(20,12,6,0.45)');
        grad.addColorStop(0.5, 'rgba(15,9,5,0.75)');
        grad.addColorStop(1, 'rgba(10,6,3,0.92)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, origY, CELL, surfY - origY);
        // Bucket-carved bottom edge
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x, surfY, CELL, 2);
        // Subtle horizontal striations to suggest tool marks
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        for (let y = origY + 6; y < surfY - 1; y += 8) {
          ctx.fillRect(x, y, CELL, 1);
        }
        // Lip highlight at hole rim
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x, origY, CELL, 2);
        ctx.fillStyle = '#3a2010';
        ctx.fillRect(x, origY + 2, CELL, 2);
      }

      // 3. Pile — covers grass when surface is built up above original.
      if (piled) {
        const ph = origY - surfY;
        const pgrad = ctx.createLinearGradient(0, surfY, 0, origY);
        pgrad.addColorStop(0, '#a87420');
        pgrad.addColorStop(1, '#7a4f10');
        ctx.fillStyle = pgrad;
        ctx.fillRect(x, surfY, CELL, ph);
        ctx.fillStyle = '#bb8030';
        ctx.fillRect(x, surfY, CELL, 1);
        if ((i % 5) === 2) {
          ctx.fillStyle = '#7a4f10';
          ctx.fillRect(x + 1, surfY + 4, 1, 1);
        }
      }
    }

    // Particles
    for (const p of this.particles) {
      const alpha = Math.min(1, p.life > 0.4 ? 1 : p.life * 2.5);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Utility for the scene to know where the ground sits at a given x.
  groundYAt(x: number): number {
    const i = Math.max(0, Math.min(this.cells - 1, Math.floor(x / CELL)));
    return this.surface[i];
  }
}
