# Pixel Printing

Split an image or a group of page elements into parts.
Each part prints in a little apart from the others, under a glowing print head, then the parts fly together and assemble into the whole.

- Three print effects: `scan` (a head sweeps down, pixels land along a ragged edge), `dust` (glowing pixels rain in), `layers` (built up from the bottom, layer by layer).
- 2D, or `depth: "3d"`: parts tilt toward the viewer with visible thickness, then swing flat as they lock in.
- Works on an image (`<img>` or a CSS background image), split into percent rectangles, or on live elements, which print in place.
- One dependency-free ES module, about 700 lines. No build step.
- Respects `prefers-reduced-motion`, works under a strict CSP and Trusted Types, and cleans up after itself.
- Not on npm yet: copy the three files in `src/`.
- Ships an [Agent Skill](skills/pixel-printing/SKILL.md) so Claude, Codex, Cursor or another coding agent can add it to a site and choose good parts.

## Quick start

```html
<link rel="stylesheet" href="pixel-printing/src/pixel-printing.css" />
<div>
  <img src="robot.svg" alt="..." width="600" height="640" data-print-pending
       data-print-parts="26.8 38.9 46.3 39.4, 28.2 13.9 43.7 25, 15.8 45.2 9.7 34.1, 74.5 45.2 9.7 34.1" />
</div>
<script type="module">
  import { pixelPrint } from "./pixel-printing/src/pixel-printing.js";
  pixelPrint(document.querySelector("img[data-print-parts]"), { depth: "3d" });
</script>
```

Each part is `x y w h` in percent of the image, printed and assembled in the order given.
Add `dx dy` to a part (`x y w h dx dy`) to choose where it prints before it assembles.

Live elements: mark the pieces with `data-print-part` and print their container.

```html
<div id="card">
  <h3 data-print-part>Fabrication queue</h3>
  <div data-print-part class="chart">...</div>
  <button data-print-part>Start next batch</button>
</div>
<script type="module">
  pixelPrint(document.getElementById("card"), { effect: "layers" });
</script>
```

## API

```js
const print = pixelPrint(targets, options);
await print.finished; // or print.finish(), print.destroy(), print.setSpeed(2)
```

- `targets`: an element, `{ el, parts?, src? }`, or an array of them.
- `options`:
  - `effect`: `"scan"` (default), `"dust"` (images only) or `"layers"`.
  - `depth`: `"2d"` (default) or `"3d"`.
  - `spread`: how far parts start from their place, as a fraction of the object's smaller side. Default `0.3`.
  - `color`: print head, outline and tint colour. Default `"#5eead4"`.
  - `speed`: `2` is twice as fast. Default `1`, about 5 to 6 seconds for 6 parts.
  - `start`: `"visible"` (default) waits until the target scrolls into view; `"now"` starts at once.
  - `onDone`: runs once when the print completes or `finish()` is called, never after `destroy()`.
- `pixelPrintAll(selector = "[data-pixel-print]", options)` starts one print per matching element.
- `parseParts("x y w h, ...")` and `autoParts()` are exported helpers.

Types are in [src/pixel-printing.d.ts](src/pixel-printing.d.ts), and the full guide is in the [skill](skills/pixel-printing/SKILL.md).

## How it works

- One `requestAnimationFrame` loop advances every target's clock by real elapsed time (clamped to 100ms per frame) times the speed, so a print never jumps ahead after a background tab.
- Every frame is a pure function of that clock, so `finish()` and `destroy()` simply stop and restore.
- The print edge is a `clip-path` polygon on each part, quantized to 4px cells. The head, outline, fresh pixels and landing flash are drawn on a small canvas per part.
- The fresh-print tint is an SVG `feColorMatrix` filter per part, built with `createElementNS`, that maps brightness to the glow colour and cures back.
- The original image is hidden with `opacity: 0` and shown again at the end. Live parts get their inline `transform`, `clip-path`, `filter` and `inert` back, and a reference count keeps overlapping prints from restoring too early.

## Using it with a coding agent

- Claude Code: copy `skills/pixel-printing/` into `~/.claude/skills/` (or the project's `.claude/skills/`), then ask "make the hero robot print itself in parts".
- Other agents: point them at `skills/pixel-printing/SKILL.md`, or copy it into the project's `AGENTS.md`.

## Run the demo and tests

```bash
npm install
npm test
python3 -m http.server 4320
```

Then open http://localhost:4320/examples/.

## License

MIT
