## Pogo Stick Dash

Web-based arcade physics demo inspired by the pogo-stick chaos of the classic Happy Wheels series. Pilot Stickman through a handcrafted course packed with ramps, drops, and spike pits — all rendered with a bespoke 2D canvas engine inside a Next.js App Router project.

### Controls

- `←` / `A` — lean back
- `→` / `D` — lean forward
- `Space`, `↑`, or `W` — compress and launch the pogo spring
- `R` — instant restart

### Local Development

```bash
npm install
npm run dev
```

Then visit [http://localhost:3000](http://localhost:3000) to play the course locally. The project uses TypeScript and the default Next.js ESLint rules; run `npm run lint` before shipping changes.

### Production Build

```bash
npm run build
npm start
```

### Notes

- Physics, collision, and drawing happen on a dedicated `<canvas>` loop — no external physics engine required.
- Responsive HUD and launch/reset overlays are rendered with React while gameplay runs fully on the canvas for maximum performance.
- The finish flag sits at 2150 units; the HUD tracks live progress, speed, run time, and best time across the session.
