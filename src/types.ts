export type Orientation = 'landscape' | 'portrait';

export interface Pointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  down: boolean;
}

export interface FrameContext {
  ctx: CanvasRenderingContext2D;
  dt: number;
  width: number;
  height: number;
  orientation: Orientation;
  pointers: Map<number, Pointer>;
}

export interface Scene {
  onEnter?(ctx: FrameContext): void;
  onResize?(ctx: FrameContext): void;
  update(ctx: FrameContext): void;
  render(ctx: FrameContext): void;
}
