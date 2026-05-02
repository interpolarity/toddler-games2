# toddler-games2

A radical redesign of the excavator game from [interpolarity/toddler-games](https://github.com/interpolarity/toddler-games), rebuilt from scratch with different priorities.

## Direction

- **Better graphics.** Vector + sprite work, layered rendering, more art polish.
- **Mobile first.** Phone screens are the primary target; iPad is a happy bonus.
- **Both orientations.** Landscape and portrait are first-class — layout adapts, not just scales.
- **Preschooler interaction (ages 3–5).** Bigger touch targets, more cause-and-effect, fewer modes, more delight.

## Stack

- Vite + TypeScript
- Canvas 2D (HiDPI-aware)
- No runtime dependencies — all game code is hand-written

## Run locally

```bash
npm install
npm run dev
```

Then open the `http://<your-lan-ip>:5173` URL on your phone (Vite is configured to host on the network).

## Build

```bash
npm run build
npm run preview
```

## Deploy

A GitHub Actions workflow at `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on push to `main`.

> **Private repo note.** GitHub Pages from a private repo requires GitHub Pro / Team / Enterprise. If you're on the Free plan, the simplest free alternatives are:
> - **Vercel** — connect the repo, default settings work. Set `VITE_BASE=/` in Vercel project env so asset paths resolve at the domain root.
> - **Netlify** — same idea. Build command `npm run build`, publish directory `dist`.

## Project layout

```
src/
  main.ts            entry — wires the engine to a scene
  engine.ts          canvas, game loop, pointer input, resize/orientation
  types.ts           shared interfaces
  scenes/
    excavator.ts     placeholder excavator scene (drag to move arm)
```

## Design notes

- `engine.ts` keeps the canvas at devicePixelRatio for crisp rendering on phones.
- `orientation` is reported as `'landscape' | 'portrait'` and is the recommended way to branch layout — do not branch on raw width.
- Touch is normalized through Pointer Events so mouse/touch/pen all behave the same.
- All audio (when added) should go through one `AudioContext`-aware helper — iOS blocks `setTimeout`-scheduled audio.
