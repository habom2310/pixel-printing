---
name: pixel-printing
description: Add the pixel-printing animation to a website, where an image or a group of page elements is split into parts, each part prints in a little apart from the others under a glowing print head (a scanline or layer-by-layer head sweeping in any direction, or pixels landing as dust, random static, noise blobs or from the centre out, in 2D or 3D), and then the parts fly together and assemble into the whole object. Use when the user wants something to look "printed", "fabricated", "3D printed", "assembled from parts" or built by future technology, wants a hero image or product shot to build itself from components, or names pixel-printing. Works with plain HTML and any framework (React, Next.js, Vue, Svelte, Astro).
---

# pixel-printing

pixel-printing is one dependency-free ES module (`src/pixel-printing.js`, about 700 lines) plus an optional CSS file (`src/pixel-printing.css`).
One call, `pixelPrint(target, options)`, works in two modes, picked from the target:

- **Image mode**: the target is an `<img>` or an element with a CSS `background-image`. It is split into parts (percent rectangles). Each part is a copy of that piece of the image.
- **Element mode**: the target is any other element. Its `[data-print-part]` descendants (or, if none are marked, its children) are the parts. The live elements themselves move, so nothing is copied.

Each part shows a dashed outline at its start position, prints in under a glowing head with a cyan "fresh print" tint that cures to its real colours, then all parts fly to their place and lock in with a flash.
At the end every change the library made is undone, and the original is shown as it was.

## 1. Install

Copy `src/pixel-printing.js`, `src/pixel-printing.d.ts` and `src/pixel-printing.css` from this repo into the project (for example `lib/pixel-printing/`) and import them with relative paths.
There are no dependencies and no build step.

Only if `npm view pixel-printing` shows the package is published: `npm install pixel-printing`, then `import { pixelPrint } from "pixel-printing"` and `import "pixel-printing/style.css"`.

## 2. Pick the look

Ask the user if they have not said, or pick from the page's tone:

| Option | Values | Look |
| --- | --- | --- |
| `effect` | `"scan"` (default) | A print head sweeps across; pixels land along a ragged edge. |
| | `"layers"` | A flat edge builds the part up layer by layer, like an FDM printer. |
| | `"dust"` | Glowing pixels rain in, denser toward `direction`. |
| | `"random"` | Every pixel lands in random order, like static resolving. |
| | `"noise"` | Pixels grow in organic blobs, like material condensing. |
| | `"radial"` | Pixels grow from the part's centre outward. |
| `direction` | `"down"`, `"up"`, `"right"`, `"left"` | Where `scan`, `layers` and `dust` print toward. Default `"down"`, or `"up"` for `layers`. |
| `depth` | `"2d"` (default), `"3d"` | `"3d"` tilts parts toward the viewer while they print and swings them flat as they land. Image parts also get visible thickness. |
| `color` | hex or `rgb()` | Head, outline and tint colour. Default `#5eead4`. Match the brand accent. |

All effects work in both modes.
On images, pattern effects copy pixels from the decoded image onto a canvas (4px cells).
On live elements they use a `clip-path` of 8px cells.

## 3a. Image mode: choose the parts

Parts decide what prints and what assembles, so do not skip this step.

1. Open the image and look at it (read the image file, or take a screenshot of the page).
2. List the 4 to 10 components a person would see as separate pieces: for a product, its body, lid, handle, buttons; for a character, head, body, arms, legs; for a UI screenshot, sidebar, header, cards, chart.
3. Write each part as `x y w h` in percent of the image's width and height (0 to 100). Measure from the pixel size: `x = left / imageWidth * 100`. Include strokes and shadows inside the rectangle.
4. Order them the way the object would be built: the core or largest piece first, attachments after it, small details (antenna, badges) last.
5. Parts should not overlap. Anything no part covers fades in at the end, so a transparent or plain background does not need a part.
6. Optional: add `dx dy` (percent of the image) to a part to choose where it prints before it assembles, for example `47 3.6 5.7 11.3 0 -15` prints the antenna above the head. By default each part starts pushed out from the centre by `spread`.

Put them on the image as `data-print-parts="26.8 38.9 46.3 39.4, 28.2 13.9 43.7 25, ..."`, or pass `{ el, parts: [{ x, y, w, h }] }`.
Without parts the library uses a 3 by 2 grid, which looks like a puzzle, not an assembly.

Images with a transparent background (PNG, SVG, WebP) look best: the parts float as real objects.

## 3b. Element mode: mark the parts

1. Pick a container that holds the pieces, such as a card grid, a pricing card, or a product feature block.
2. Add `data-print-part` to each piece that should print on its own: a card, a heading, a chart, a button. Pieces should have their own background, so they read as objects while they fly.
3. Optional: `data-print-part="dx dy"` sets the start offset in percent of the container.
4. Do not nest parts inside parts.

The container itself stays visible and still, so its background acts as the print bed.

## 4. Wire it in

Plain HTML:

```html
<link rel="stylesheet" href="/lib/pixel-printing/pixel-printing.css" />
<div class="hero-art">
  <img src="/robot.png" alt="..." width="600" height="640" data-print-pending
       data-print-parts="26.8 38.9 46.3 39.4, 28.2 13.9 43.7 25, 15.8 45.2 9.7 34.1" />
</div>
<script type="module">
  import { pixelPrint } from "/lib/pixel-printing/pixel-printing.js";
  pixelPrint(document.querySelector("img[data-print-parts]"), { effect: "scan", depth: "3d" });
</script>
```

React or Next.js (client component):

```tsx
"use client";
import { useEffect, useRef } from "react";
import { pixelPrint } from "@/lib/pixel-printing/pixel-printing.js";

export function PrintedImage(props: React.ComponentProps<"img"> & { parts: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const print = pixelPrint(ref.current!, { depth: "3d" });
    return () => print.destroy();
  }, []);
  const { parts, ...img } = props;
  return <img ref={ref} {...img} data-print-pending="" data-print-parts={parts} />;
}
```

For Vue, Svelte or Astro, do the same: call `pixelPrint(el)` after mount and `destroy()` on unmount.
Several targets can share one call: `pixelPrint([img, cardGrid])`. Each starts on its own when it scrolls into view.
`pixelPrintAll("[data-pixel-print]", options)` starts one print per matching element.

## 5. Options and lifecycle

| Option | Default | Use |
| --- | --- | --- |
| `effect` | `"scan"` | `"scan"`, `"layers"`, `"dust"`, `"random"`, `"noise"` or `"radial"` |
| `direction` | `"down"` (`"up"` for layers) | `"down"`, `"up"`, `"right"` or `"left"` |
| `depth` | `"2d"` | `"3d"` for tilt and thickness |
| `spread` | `0.3` | How far parts start from their place, as a fraction of the object's smaller side. Use 0.15 to 0.2 for wide objects. |
| `color` | `"#5eead4"` | Print head, outline and tint colour |
| `speed` | `1` | `2` plays twice as fast (about 5 to 6s at 1 for 6 parts) |
| `start` | `"visible"` | `"now"` starts at once instead of when the target scrolls into view |
| `onDone` | none | Called once when the print completes or `finish()` is called |

The return value:

- `finished` is a Promise that always resolves, however the print ends.
- `finish()` jumps to the finished object, and `onDone` runs.
- `destroy()` removes everything now, and `onDone` does not run. Call it on unmount.
- `setSpeed(n)` changes the speed while it runs.

## 6. Rules to keep

- Leave room around the object. Parts start up to `spread` away from their place, and in 3D they also grow a little as they tilt toward the viewer. A parent with `overflow: hidden` cuts them off; give it padding or lower `spread`.
- `data-print-pending` plus the CSS file keep the image or parts hidden until the script starts, so they do not flash finished first. If the script never runs, the CSS shows them after 4 seconds. Leave it off when the image is the page's LCP element and load time matters more than the effect.
- Reduced motion (`prefers-reduced-motion: reduce`) shows the finished object and never animates. Do not override this.
- In element mode, hidden parts are `inert` until they start to print, so keyboard focus never lands on something invisible.
- While it runs, the library inserts an overlay right after the image (image mode) or inside the container (element mode). If that parent was static, it also sets `position: relative` on it. Both are undone at the end.
  - Give an image a block-level parent of its own, such as a `<div>` or `<figure>`. Inline parents like `<a>` or `<picture>` can misplace the overlay.
  - Sibling CSS like `:last-child` or Tailwind `space-y-*` can briefly change while the overlay is there.
- The image is copied as a CSS background stretched to the image's content box. Borders and padding on the image are fine, but `object-fit: cover` or `contain` crops are not reproduced.
- For an element with a CSS `background-image`, only the first image is used, stretched the same way, and the whole element (with its children and background colour) is hidden while it prints. Use a plain `<img>` when you can.
- A rounded image keeps rounded corners on its corner parts only for pixel radii, not percent radii.
- Parts get `transition: none` while they print, so a CSS transition on a part does not smear the motion. It is restored at the end.
- If a target is removed from the page mid-print, the print stops as if `destroy()` was called.
- Under a strict CSP or Trusted Types no change is needed: the library builds every element with DOM calls, sets styles through the CSSOM, and uses no `innerHTML`, `<style>` or inline script. The image URL must be allowed by `img-src`. `"dust"` draws the image on a canvas; a cross-origin image works for display without CORS headers.

## 7. Verify

1. Load the page and watch one full print. Each part should be one real component, and the assembled result should match the original exactly, with no seams or jumps at the end.
2. Check that no part flies outside a clipped parent. If one does, lower `spread` or add padding.
3. Check a phone width (375px).
4. Turn on reduced motion in the OS or browser dev tools: the object must show at once, with no animation.
5. Check the console for errors, and that no `aria-hidden` overlay is left in the DOM after it finishes.
