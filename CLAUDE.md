# toddler-games2 — Project Guidelines

## Mission
Radical redesign of the excavator game from `interpolarity/toddler-games`. Goals: better graphics, mobile-first, landscape + portrait, preschooler-suitable interaction (3–5 years).

## Architecture
- Vite + TypeScript, no runtime deps
- Canvas 2D, HiDPI via `dpr` scaling in `engine.ts`
- Scenes implement the `Scene` interface from `src/types.ts`
- One `Engine` owns the canvas, loop, pointer state, and orientation

## Layout rules
- Branch layout on `orientation` (`'landscape' | 'portrait'`), not raw width
- Use `Math.min(width, height)` for proportional sizes
- Reserve safe-area insets when adding HUD elements that hug screen edges

## Input
- Pointer Events only — `engine.ts` normalizes mouse/touch/pen
- `pointers` is a `Map<id, Pointer>`. First pointer drives single-finger play; check `.size > 1` for multi-touch features
- Always `e.preventDefault()` on pointerdown/move so iOS doesn't scroll the page

## Audio (when added)
- One shared `AudioContext`, unlocked on first pointerdown
- Schedule on the audio timeline, never via `setTimeout` (iOS blocks it)
- Volumes capped — square/sawtooth ≤ 0.12, sine ≤ 0.15
- Provide a `sayWord(word)` helper that prefers an English voice on non-English devices

## Preschooler UX bar
- Touch targets ≥ 64 CSS px
- Every touch must produce immediate visual feedback (within one frame)
- No timeouts longer than 3s for failure states; favor positive feedback
- Avoid text-only UI — use shapes, color, motion

## Performance
- Cap particle arrays (sand, sparks, dust) — return early if over the cap
- Clear all transient state when changing scene
- Target 60fps on a 2019-era phone (iPhone 11 / Pixel 4 class)
