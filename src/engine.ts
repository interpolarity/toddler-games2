import type { Scene, FrameContext, Pointer, Orientation } from './types';

export class Engine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scene: Scene | null = null;
  private last = 0;
  private running = false;

  width = 0;
  height = 0;
  dpr = 1;
  orientation: Orientation = 'landscape';

  private readonly pointers = new Map<number, Pointer>();

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => this.resize());

    this.bindPointer('pointerdown', 'down');
    this.bindPointer('pointermove', 'move');
    this.bindPointer('pointerup', 'up');
    this.bindPointer('pointercancel', 'up');

    // iOS: stop pinch/zoom gestures from blocking single-finger play
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('gesturechange', (e) => e.preventDefault());
  }

  setScene(scene: Scene) {
    this.scene = scene;
    scene.onEnter?.(this.frameContext(0));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
  }

  private tick = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const ctx = this.frameContext(dt);
    this.scene?.update(ctx);
    this.ctx.save();
    this.ctx.scale(this.dpr, this.dpr);
    this.scene?.render(ctx);
    this.ctx.restore();
    requestAnimationFrame(this.tick);
  };

  private frameContext(dt: number): FrameContext {
    return {
      ctx: this.ctx,
      dt,
      width: this.width,
      height: this.height,
      orientation: this.orientation,
      pointers: this.pointers
    };
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.orientation = rect.width >= rect.height ? 'landscape' : 'portrait';
    this.scene?.onResize?.(this.frameContext(0));
  }

  private bindPointer(event: string, phase: 'down' | 'move' | 'up') {
    this.canvas.addEventListener(event as keyof HTMLElementEventMap, (e) => {
      const pe = e as PointerEvent;
      pe.preventDefault();
      const id = pe.pointerId;
      const x = pe.clientX;
      const y = pe.clientY;
      if (phase === 'down') {
        this.canvas.setPointerCapture(id);
        this.pointers.set(id, { id, x, y, startX: x, startY: y, down: true });
      } else if (phase === 'move') {
        const p = this.pointers.get(id);
        if (p) {
          p.x = x;
          p.y = y;
        }
      } else {
        this.pointers.delete(id);
      }
    }, { passive: false });
  }
}
