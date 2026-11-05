// pixel-printing: the parts of an image or element print in apart, then assemble into the whole.
// Dependency-free ES module. MIT licensed. See README.md and skills/pixel-printing/SKILL.md.

export const EFFECTS = ["scan", "layers", "dust", "random", "noise", "radial"];
export const DIRECTIONS = ["down", "up", "right", "left"];
/** Effects with a moving print head; the others print cell by cell in a pattern. */
const SWEEPS = new Set(["scan", "layers"]);

/** Three columns by two rows: a fallback for when an image has no parts. */
export function autoParts() {
  const third = 100 / 3;
  return [0, 1].flatMap((row) => [0, 1, 2].map((col) => ({ x: col * third, y: row * 50, w: third, h: 50 })));
}

/** Parses "x y w h, x y w h dx dy" (percent of the image) into parts. dx dy set the start offset. */
export function parseParts(text) {
  return text
    .split(/[,;]/)
    .map((part) => part.trim().split(/\s+/).map(Number))
    .filter((n) => (n.length === 4 || n.length === 6) && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0)
    .map(([x, y, w, h, dx, dy]) => (dx === undefined ? { x, y, w, h } : { x, y, w, h, dx, dy }));
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const CELL = 4; // printed pixel size, in CSS px
const FX = 12; // room around a part for the print head's glow
const BLEED = 40; // clips reach this far past a part, so its shadow shows as it prints
const HIDDEN = "inset(0 0 100% 0)";
const px = (n) => `${Math.round(n * 100) / 100}px`;

/** A small seeded random generator, so every run of a part looks the same. */
function random(seed) {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function el(tag, style, parent) {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  parent?.appendChild(node);
  return node;
}

function rgb(color) {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color);
  return m ? m.slice(1, 4).map(Number) : null;
}

function imageSource(node) {
  if (node instanceof HTMLImageElement) return node.currentSrc || node.src;
  return getComputedStyle(node).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] ?? "";
}

/** Inline styles a print changed, kept while any print holds the node, so overlapping prints restore them once. */
const held = new WeakMap();
function hold(node, props, inert = false) {
  const entry = held.get(node) ?? { style: {}, count: 0 };
  for (const p of props) if (!(p in entry.style)) entry.style[p] = node.style[p];
  if (inert && !("inert" in entry)) entry.inert = node.inert;
  entry.count++;
  held.set(node, entry);
  return entry;
}
function release(node) {
  const entry = held.get(node);
  if (!entry || --entry.count > 0) return;
  held.delete(node);
  Object.assign(node.style, entry.style);
  if ("inert" in entry) node.inert = entry.inert;
}

/** Gives a static element `position: relative` while a print uses it as the overlay's anchor. */
function anchor(node) {
  hold(node, ["position"]);
  if (["static", ""].includes(getComputedStyle(node).position)) node.style.position = "relative";
  return () => release(node);
}

/** When each part prints and lands, in seconds at speed 1. About 5-6s for 6 parts. */
function timeline(n) {
  const lead = 0.25; // the dashed outline shows this long before printing starts
  const stagger = Math.min(0.35, 2.4 / n);
  const print = 1.3;
  const assembleAt = lead + (n - 1) * stagger + print + 0.35;
  const astagger = Math.min(0.14, 1.2 / n);
  const travel = 0.8;
  const landed = assembleAt + (n - 1) * astagger + travel;
  return { lead, stagger, print, cure: 0.5, assembleAt, astagger, travel, landed, end: landed + 0.5 };
}

/** Where one part is at time t. */
function partState(i, t, tl) {
  const s0 = tl.lead + i * tl.stagger;
  const shown = t >= s0 - tl.lead;
  const pt = clamp01((t - s0) / tl.print);
  const a0 = tl.assembleAt + i * tl.astagger;
  const at = clamp01((t - a0) / tl.travel);
  const cure = clamp01((t - s0 - tl.print * 0.2) / (tl.print * 0.8 + tl.cure));
  const outline = shown ? clamp01((t - s0 + tl.lead) / tl.lead) * (1 - clamp01((pt - 0.8) / 0.2)) : 0;
  const flash = at >= 1 ? 1 - clamp01((t - a0 - tl.travel) / 0.45) : 0;
  return { shown, pt, k: 1 - easeInOut(at), tint: 1 - cure, outline, flash };
}

/** Start offset, away from the object's centre. (cx, cy) is the part's centre relative to it. */
function offsetFor(cx, cy, ow, oh, spread, given) {
  if (given) return { dx: (given.dx / 100) * ow, dy: (given.dy / 100) * oh };
  const len = Math.hypot(cx, cy);
  if (!len) return { dx: 0, dy: 0 };
  const d = spread * Math.min(ow, oh) * Math.min(1, (len / Math.hypot(ow, oh)) * 6);
  return { dx: (cx / len) * d, dy: (cy / len) * d };
}

function moveTransform(p, k, depth) {
  if (k <= 0) return null;
  const x = px(p.dx * k);
  const y = px(p.dy * k);
  if (depth !== "3d") return `translate(${x}, ${y}) scale(${1 - 0.06 * k})`;
  const side = p.dx < 0 ? -1 : 1;
  return `perspective(1000px) translate3d(${x}, ${y}, ${px(70 * k)}) rotateX(${40 * k}deg) rotateZ(${10 * side * k}deg)`;
}

/** Sweeps work in (u, v): v runs from the edge printing starts at, u along that edge. */
function axes(p, dir) {
  const vertical = dir === "down" || dir === "up";
  return { along: vertical ? p.h : p.w, across: vertical ? p.w : p.h };
}
function toXY(p, dir, u, v) {
  if (dir === "up") return [u, p.h - v];
  if (dir === "right") return [v, u];
  if (dir === "left") return [p.w - v, u];
  return [u, v];
}
/** A (u, v) rectangle as x, y, width, height. */
function rectXY(p, dir, [u0, v0, u1, v1]) {
  const [ax, ay] = toXY(p, dir, u0, v0);
  const [bx, by] = toXY(p, dir, u1, v1);
  return [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)];
}

/** How far each lane of pixels has printed. Scan has a ragged edge; layers a flat one. */
function sweep(p, pt, effect, dir) {
  const { along } = axes(p, dir);
  if (effect === "layers") {
    const layer = CELL * 2;
    const filled = pt >= 1 ? along : Math.floor((pt * along) / layer) * layer;
    return p.jit.map(() => filled);
  }
  const reach = pt * (along + 4 * CELL);
  return p.jit.map((j) => Math.min(along, Math.max(0, Math.floor((reach - j * CELL) / CELL) * CELL)));
}

function sweepClip(p, filled, dir) {
  const { along, across } = axes(p, dir);
  const last = filled.length - 1;
  const uv = [
    [-BLEED, -BLEED],
    [across + BLEED, -BLEED],
  ];
  for (let c = last; c >= 0; c--) {
    const v = filled[c] >= along ? along + BLEED : filled[c];
    uv.push([c === last ? across + BLEED : (c + 1) * CELL, v], [c === 0 ? -BLEED : c * CELL, v]);
  }
  return `polygon(${uv.map(([u, v]) => toXY(p, dir, u, v).map(px).join(" ")).join(", ")})`;
}

/** Smooth 2D value noise in 0..1, two octaves, seeded. */
function valueNoise(seed) {
  const hash = (x, y) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1013904223);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const octave = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), xf), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), xf), yf);
  };
  return (x, y) => octave(x, y) * 0.7 + octave(x * 2.3 + 17, y * 2.3 + 31) * 0.3;
}

/** When cell (x, y) of a cols by rows grid prints, as a sort key; lower prints first. */
function cellOrder(effect, dir, cols, rows, seed) {
  const rnd = random(seed);
  if (effect === "random") return () => rnd();
  if (effect === "noise") {
    const noise = valueNoise(seed);
    const blob = Math.max(3, Math.max(cols, rows) / 5); // about five blobs across
    return (x, y) => noise(x / blob, y / blob) * 0.85 + rnd() * 0.15;
  }
  if (effect === "radial") return (x, y) => Math.hypot((x + 0.5) / cols - 0.5, (y + 0.5) / rows - 0.5) + rnd() * 0.3;
  // Dust: denser toward the direction it prints in.
  const along = {
    down: (x, y) => y / rows,
    up: (x, y) => 1 - y / rows,
    right: (x) => x / cols,
    left: (x) => 1 - x / cols,
  }[dir];
  return (x, y) => along(x, y) * 0.55 + rnd() * 0.45;
}

/** Every pixel cell of a part, sorted by when it prints. */
function buildCells(p, effect, dir, cell) {
  const cols = Math.max(1, Math.ceil(p.w / cell));
  const rows = Math.max(1, Math.ceil(p.h / cell));
  const order = cellOrder(effect, dir, cols, rows, p.i * 97 + 3);
  const cells = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push({ x, y, k: order(x, y) });
  cells.sort((a, b) => a.k - b.k);
  Object.assign(p, { cells, cols, rows, cell, n: 0, clipN: -1, drawn: 0 });
}

const printedCells = (p, pt) => (pt >= 1 ? p.cells.length : Math.floor(easeInOut(pt) * p.cells.length));

/** The printed cells as one clip-path: a rectangle per run of cells in a row, joined at the corner. */
function cellsClip(p) {
  if (p.clipN === p.n) return p.clipText;
  const { cols, rows, cell, cells, n } = p;
  const grid = new Uint8Array(cols * rows);
  for (let c = 0; c < n; c++) grid[cells[c].y * cols + cells[c].x] = 1;
  const pts = ["0 0"];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; ) {
      if (!grid[y * cols + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < cols && grid[y * cols + e]) e++;
      const [x0, x1, y0, y1] = [x * cell, Math.min(p.w, e * cell), y * cell, Math.min(p.h, (y + 1) * cell)].map(px);
      pts.push(`${x0} ${y0}`, `${x1} ${y0}`, `${x1} ${y1}`, `${x0} ${y1}`, `${x0} ${y0}`, "0 0");
      x = e;
    }
  }
  p.clipN = n;
  p.clipText = `polygon(${pts.join(", ")})`;
  return p.clipText;
}

/** The clip for a part at print progress pt, or null once it is fully printed. */
function printClip(p, pt, filled, o) {
  if (pt <= 0) return HIDDEN;
  if (pt >= 1) return null;
  return SWEEPS.has(o.effect) ? sweepClip(p, filled, o.direction) : cellsClip(p);
}

/** Sizes a part's canvases and rebuilds its pixel lanes or cells after a resize. */
function sizePart(p, dpr, o) {
  const lanes = Math.max(1, Math.ceil(axes(p, o.direction).across / CELL));
  if (p.jit?.length !== lanes) {
    const rnd = random(p.i * 31 + 7);
    p.jit = Array.from({ length: lanes }, () => Math.floor(rnd() * 4));
  }
  const width = Math.ceil((p.w + 2 * FX) * dpr);
  const height = Math.ceil((p.h + 2 * FX) * dpr);
  if (p.fx.width !== width || p.fx.height !== height) {
    Object.assign(p.fx, { width, height });
    Object.assign(p.fx.style, { width: px(p.w + 2 * FX), height: px(p.h + 2 * FX) });
    p.fxClear = false;
  }
  if (SWEEPS.has(o.effect)) return;
  // Canvas cells can be fine; clip-path cells are coarser to keep the path short.
  if (p.sizedW !== p.w || p.sizedH !== p.h) {
    p.sizedW = p.w;
    p.sizedH = p.h;
    buildCells(p, o.effect, o.direction, p.paint ? CELL : CELL * 2);
  }
  if (p.paint) {
    const w = Math.ceil(p.w * dpr);
    const h = Math.ceil(p.h * dpr);
    if (p.paint.canvas.width !== w || p.paint.canvas.height !== h) {
      Object.assign(p.paint.canvas, { width: w, height: h });
      p.drawn = 0;
    }
  }
}

/** Draws the outline, print head, fresh pixels and landing flash. Needs a 2D canvas; skipped without one. */
function paintFx(p, s, filled, o, dpr, t) {
  const ctx = p.ctx;
  if (!ctx) return;
  const head = s.pt > 0 && s.pt < 1;
  if (!head && !s.outline && !s.flash) {
    if (!p.fxClear) ctx.clearRect(0, 0, p.fx.width, p.fx.height);
    p.fxClear = true;
    return;
  }
  p.fxClear = false;
  const { w, h } = p;
  const { color, direction: dir } = o;
  ctx.setTransform(dpr, 0, 0, dpr, FX * dpr, FX * dpr);
  ctx.clearRect(-FX, -FX, w + 2 * FX, h + 2 * FX);
  ctx.fillStyle = ctx.strokeStyle = ctx.shadowColor = color;
  ctx.shadowBlur = 0;
  if (s.outline) {
    ctx.globalAlpha = 0.6 * s.outline;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.setLineDash([]);
  }
  if (head && !SWEEPS.has(o.effect)) {
    // The newest cells glow, fading as more land.
    const { cells, cell, n } = p;
    const fresh = Math.max(1, Math.floor(cells.length * 0.08));
    for (let c = Math.max(0, n - fresh); c < n; c++) {
      ctx.globalAlpha = 1 - (n - c) / fresh;
      ctx.fillRect(cells[c].x * cell, cells[c].y * cell, cell - 1, cell - 1);
    }
  } else if (head) {
    const { along, across } = axes(p, dir);
    const hv = o.effect === "layers" ? filled[0] : Math.min(along, s.pt * (along + 4 * CELL));
    // The head: a bright bar with a glow, across the part.
    ctx.globalAlpha = 0.95;
    ctx.shadowBlur = 12;
    ctx.fillRect(...rectXY(p, dir, [-4, hv - 1, across + 4, hv + 1]));
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#fff";
    ctx.fillRect(...rectXY(p, dir, [-2, hv - 0.5, across + 2, hv + 0.5]));
    ctx.fillStyle = color;
    // Pixels it just laid down, flickering along the edge.
    const rnd = random(Math.floor(t * 30) * 7 + p.i);
    filled.forEach((f, c) => {
      const v = f - CELL;
      if (v < 0 || v >= along || rnd() < 0.35) return;
      ctx.globalAlpha = 0.4 + rnd() * 0.6;
      ctx.fillRect(...rectXY(p, dir, [c * CELL, v, c * CELL + CELL - 1, v + CELL - 1]));
      if (o.effect === "scan" && v >= CELL && rnd() < 0.3)
        ctx.fillRect(...rectXY(p, dir, [c * CELL, v - CELL, c * CELL + CELL - 1, v - 1]));
    });
  }
  if (s.flash) {
    ctx.globalAlpha = 0.8 * s.flash;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 8 * s.flash;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

/** Copies the newly printed cells of a part from the decoded source image onto its canvas. */
function paintCells(p, image, dpr) {
  const { ctx, canvas } = p.paint;
  const { cells, cell, n } = p;
  if (n === p.drawn) return;
  if (n < p.drawn) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    p.drawn = 0;
  }
  const sx = (p.r.x / 100) * image.naturalWidth;
  const sy = (p.r.y / 100) * image.naturalHeight;
  const fx = ((p.r.w / 100) * image.naturalWidth) / p.w;
  const fy = ((p.r.h / 100) * image.naturalHeight) / p.h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let c = p.drawn; c < n; c++) {
    const x = cells[c].x * cell;
    const y = cells[c].y * cell;
    const cw = Math.min(cell, p.w - x);
    const ch = Math.min(cell, p.h - y);
    if (cw > 0 && ch > 0) ctx.drawImage(image, sx + x * fx, sy + y * fy, cw * fx, ch * fy, x, y, cw, ch);
  }
  p.drawn = n;
}

const SVG = "http://www.w3.org/2000/svg";
let runs = 0;

/**
 * The fresh-print tint: one SVG colour-matrix filter per part, mixing the part's own colours with
 * its brightness in the glow colour. Built with DOM calls, so it works under strict CSP.
 */
function tints(count, color, parent) {
  const glow = (rgb(color) ?? [94, 234, 212]).map((v) => v / 255);
  const svg = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({ width: 0, height: 0, "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, v);
  Object.assign(svg.style, { position: "absolute", width: "0", height: "0", overflow: "hidden" });
  const run = ++runs;
  const list = Array.from({ length: count }, (_, i) => {
    const filter = document.createElementNS(SVG, "filter");
    const matrix = document.createElementNS(SVG, "feColorMatrix");
    const id = `pixel-print-${run}-${i}`;
    filter.setAttribute("id", id);
    filter.setAttribute("color-interpolation-filters", "sRGB");
    matrix.setAttribute("type", "matrix");
    filter.appendChild(matrix);
    svg.appendChild(filter);
    return { url: `url(#${id})`, matrix, m: -1 };
  });
  parent.appendChild(svg);
  return list.map((tint) => (m, base) => {
    if (m <= 0.005) return base;
    if (Math.abs(m - tint.m) > 0.01) {
      tint.m = m;
      const luma = [0.2126, 0.7152, 0.0722];
      const rows = glow.map((c, row) => [...luma.map((l, col) => (row === col ? 1 - m : 0) + m * 1.3 * c * l), 0, 0]);
      tint.matrix.setAttribute("values", [...rows.flat(), 0, 0, 0, 1, 0].map((v) => Math.round(v * 1e4) / 1e4).join(" "));
    }
    return base ? `${base} ${tint.url}` : tint.url;
  });
}

const dprNow = () => Math.min(2, globalThis.devicePixelRatio || 1);

function context(canvas) {
  try {
    return canvas.getContext("2d");
  } catch {
    return null;
  }
}

/** A copy of the image showing only region r, as a background stretched over the part. */
function tile(src, r, extra, parent) {
  return el(
    "div",
    {
      position: "absolute",
      inset: "0",
      backgroundImage: `url(${JSON.stringify(src)})`,
      backgroundSize: `${10000 / r.w}% ${10000 / r.h}%`,
      backgroundPosition: `${r.w < 100 ? (r.x / (100 - r.w)) * 100 : 0}% ${r.h < 100 ? (r.y / (100 - r.h)) * 100 : 0}%`,
      ...extra,
    },
    parent,
  );
}

/** One image whose regions print, then assemble. */
function imageJob(node, regions, src, o) {
  const tl = timeline(regions.length);
  const job = { node, t: 0, end: tl.end };
  let image = null;
  // Pixel patterns copy cells from the decoded image onto a canvas.
  const cellsMode = !SWEEPS.has(o.effect);
  job.ready =
    cellsMode
      ? new Promise((resolve) => {
          const img = new Image();
          img.src = src;
          img
            .decode()
            .then(() => (image = img.naturalWidth ? img : null))
            .catch(() => {})
            .finally(resolve);
        })
      : Promise.resolve();

  let layer;
  let final;
  let size = { w: -1, h: -1 };
  const parts = regions.map((r, i) => ({ r, i }));

  // The image paints in its content box; the overlay covers exactly that.
  const place = () => {
    const parent = node.parentElement;
    if (!node.isConnected || !parent || parent !== layer.parentElement) return (job.detached = true);
    const cs = getComputedStyle(node);
    const n = (k) => parseFloat(cs[k]) || 0;
    const r = node.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    const l = n("borderLeftWidth") + n("paddingLeft");
    const t = n("borderTopWidth") + n("paddingTop");
    const w = r.width - l - n("borderRightWidth") - n("paddingRight");
    const h = r.height - t - n("borderBottomWidth") - n("paddingBottom");
    Object.assign(layer.style, {
      left: px(r.left + l - p.left - parent.clientLeft + parent.scrollLeft),
      top: px(r.top + t - p.top - parent.clientTop + parent.scrollTop),
      width: px(w),
      height: px(h),
    });
    if (w === size.w && h === size.h) return;
    size = { w, h };
    const dpr = dprNow();
    parts.forEach((p) => {
      p.w = (p.r.w / 100) * w;
      p.h = (p.r.h / 100) * h;
      const cx = ((p.r.x + p.r.w / 2 - 50) / 100) * w;
      const cy = ((p.r.y + p.r.h / 2 - 50) / 100) * h;
      Object.assign(p, offsetFor(cx, cy, w, h, o.spread, p.r.dx === undefined ? null : p.r));
      sizePart(p, dpr, o);
    });
  };

  job.prepare = () => {
    const parent = node.parentElement;
    const unanchor = anchor(parent);
    hold(node, ["opacity"]);
    node.style.opacity = "0";
    layer = el("div", { position: "absolute", pointerEvents: "none", zIndex: "1" });
    layer.setAttribute("aria-hidden", "true");
    node.after(layer);
    const tinters = tints(parts.length, o.color, layer);
    parts.forEach((p) => {
      const { r } = p;
      p.tint = tinters[p.i];
      p.group = el(
        "div",
        {
          position: "absolute",
          left: `${r.x}%`,
          top: `${r.y}%`,
          width: `${r.w}%`,
          height: `${r.h}%`,
          visibility: "hidden",
          willChange: "transform",
          transformStyle: o.depth === "3d" ? "preserve-3d" : "",
        },
        layer,
      );
      // Thickness: darker copies stacked behind the part, seen while it is tilted.
      p.copies =
        o.depth === "3d"
          ? [3, 2, 1].map((k) => tile(src, r, { transform: `translateZ(-${k * 3}px)`, filter: `brightness(${0.62 - k * 0.1})` }, p.group))
          : [];
      if (cellsMode) {
        const canvas = el("canvas", { position: "absolute", inset: "0", width: "100%", height: "100%" }, p.group);
        const ctx = context(canvas);
        if (ctx) p.paint = { canvas, ctx };
        else canvas.remove();
      }
      p.tile = p.paint ? p.paint.canvas : tile(src, r, {}, p.group);
      p.fx = el("canvas", { position: "absolute", left: `-${FX}px`, top: `-${FX}px` }, p.group);
      p.ctx = context(p.fx);
    });
    // A rounded image: parts at its corners keep those corners rounded.
    const cs = getComputedStyle(node);
    const radius = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((c) => cs[`border${c}Radius`] || "0px");
    const near = (a, b) => Math.abs(a - b) < 0.01;
    parts.forEach((p) => {
      const { x, y, w, h } = p.r;
      const at = [near(x, 0) && near(y, 0), near(x + w, 100) && near(y, 0), near(x + w, 100) && near(y + h, 100), near(x, 0) && near(y + h, 100)];
      const plain = radius.every((r) => /^[\d.]+px$/.test(r));
      p.rest = plain && at.some((on, c) => on && parseFloat(radius[c])) ? `inset(0 round ${radius.map((r, c) => (at[c] ? r : "0")).join(" ")})` : "";
    });
    final = tile(src, { x: 0, y: 0, w: 100, h: 100 }, { opacity: "0", borderRadius: cs.borderRadius }, layer);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    return () => {
      observer.disconnect();
      layer.remove();
      release(node);
      unanchor();
    };
  };

  job.render = (t) => {
    if (place() === true) return;
    // Without the decoded image, pattern cells print through a clip-path instead of the canvas.
    if (cellsMode && !image && job.started && parts.some((p) => p.paint)) {
      const dpr = dprNow();
      parts.forEach((p) => {
        p.paint?.canvas.remove();
        p.paint = null;
        p.tile = tile(src, p.r, {}, null);
        p.group.insertBefore(p.tile, p.fx);
        p.sizedW = -1;
        sizePart(p, dpr, o);
      });
    }
    const dpr = dprNow();
    parts.forEach((p) => {
      const s = partState(p.i, t, tl);
      p.group.style.visibility = s.shown ? "" : "hidden";
      p.group.style.transform = moveTransform(p, s.k, o.depth) ?? "";
      const filled = cellsMode ? null : sweep(p, s.pt, o.effect, o.direction);
      if (cellsMode) p.n = printedCells(p, s.pt);
      let backs = s.k;
      if (p.paint) {
        if (image) paintCells(p, image, dpr);
        p.tile.style.clipPath = p.rest;
        p.copies.forEach((c) => (c.style.clipPath = p.rest));
        backs *= p.n / p.cells.length;
      } else {
        const clip = printClip(p, s.pt, filled, o) ?? p.rest;
        p.tile.style.clipPath = clip;
        p.copies.forEach((c) => (c.style.clipPath = clip));
      }
      p.copies.forEach((c) => (c.style.opacity = String(backs)));
      p.tile.style.filter = p.tint(s.tint, "");
      paintFx(p, s, filled, o, dpr, t);
    });
    // Whatever no part covers fades in once everything has landed.
    final.style.opacity = String(clamp01((t - tl.landed) / 0.4));
  };
  return job;
}

/** One element whose part elements print, then assemble, live in the page. */
function elementJob(container, nodes, o) {
  const tl = timeline(nodes.length);
  const job = { node: container, t: 0, end: tl.end, ready: Promise.resolve() };
  const parts = nodes.map((node, i) => {
    const given = node.dataset.printPart ? parseParts(`0 0 0 0 ${node.dataset.printPart}`)[0] : null;
    return { node, i, given: given?.dx === undefined ? null : given };
  });
  let layer;
  let last = -1;

  // Rest positions, measured with our transforms taken off.
  const measure = () => {
    if (!container.isConnected) return (job.detached = true);
    parts.forEach((p) => (p.node.style.transform = p.rest.transform));
    const c = container.getBoundingClientRect();
    const ox = c.left + container.clientLeft - container.scrollLeft;
    const oy = c.top + container.clientTop - container.scrollTop;
    const dpr = dprNow();
    parts.forEach((p) => {
      const r = p.node.getBoundingClientRect();
      Object.assign(p, { x: r.left - ox, y: r.top - oy, w: r.width, h: r.height });
      const cx = r.left + r.width / 2 - (c.left + c.width / 2);
      const cy = r.top + r.height / 2 - (c.top + c.height / 2);
      Object.assign(p, offsetFor(cx, cy, c.width, c.height, o.spread, p.given));
      sizePart(p, dpr, o);
      Object.assign(p.fx.style, { left: px(p.x - FX), top: px(p.y - FX) });
    });
    if (last >= 0) job.render(last);
  };

  job.prepare = () => {
    const unanchor = anchor(container);
    layer = el("div", { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "1" });
    layer.setAttribute("aria-hidden", "true");
    const tinters = tints(parts.length, o.color, layer);
    parts.forEach((p) => {
      p.tint = tinters[p.i];
      const entry = hold(p.node, ["transform", "clipPath", "filter", "transition"], true);
      p.rest = entry.style;
      // The node's own transform and filter from CSS, read before any print touched it.
      if (!entry.base) {
        const cs = getComputedStyle(p.node);
        entry.base = {
          transform: cs.transform && cs.transform !== "none" ? cs.transform : "",
          filter: cs.filter && cs.filter !== "none" ? cs.filter : "",
        };
      }
      p.base = entry.base;
      // A CSS transition would smear every frame and skew measuring.
      p.node.style.transition = "none";
      p.node.style.clipPath = HIDDEN;
      p.node.inert = true;
      p.fx = el("canvas", { position: "absolute" }, layer);
      p.ctx = context(p.fx);
    });
    container.appendChild(layer);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    parts.forEach((p) => observer.observe(p.node));
    return () => {
      observer.disconnect();
      layer.remove();
      parts.forEach((p) => release(p.node));
      unanchor();
    };
  };

  job.render = (t) => {
    if (!container.isConnected) return (job.detached = true);
    last = t;
    const dpr = dprNow();
    parts.forEach((p) => {
      const s = partState(p.i, t, tl);
      const move = moveTransform(p, s.k, o.depth);
      p.node.style.transform = move ? `${move} ${p.base.transform}` : p.rest.transform;
      p.fx.style.transform = move ?? "";
      const filled = SWEEPS.has(o.effect) ? sweep(p, s.pt, o.effect, o.direction) : null;
      if (!filled) p.n = printedCells(p, s.pt);
      p.node.style.clipPath = printClip(p, s.pt, filled, o) ?? p.rest.clipPath;
      p.node.style.filter = s.tint > 0.005 ? p.tint(s.tint, p.base.filter) : p.rest.filter;
      // Focusable again once it starts to print, unless another print still hides it.
      const inert = s.pt <= 0;
      if (p.node.inert !== inert && (inert || (held.get(p.node)?.count ?? 0) <= 1)) p.node.inert = inert;
      paintFx(p, s, filled, o, dpr, t);
    });
  };
  return job;
}

const stopped = { finished: Promise.resolve(), finish() {}, destroy() {}, setSpeed() {} };

/** The shared engine: one rAF loop advances every job's clock by real time times the speed. */
function run(jobs, options) {
  const { start = "visible", onDone } = options;
  let speed = options.speed > 0 ? options.speed : 1;
  let ended = false;
  let resolveFinished;
  const finished = new Promise((r) => (resolveFinished = r));
  const cleanups = [];
  let frame = 0;
  let last = 0;

  const end = (completed) => {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    cleanups.splice(0).reverse().forEach((fn) => fn());
    resolveFinished();
    if (completed) onDone?.();
  };

  const tick = (now) => {
    try {
      // Clamped so a tab coming back from the background doesn't jump to the end.
      const dt = last ? (Math.min(now - last, 100) * speed) / 1000 : 0;
      last = now;
      for (const job of jobs) {
        if (!job.started || job.t >= job.end) continue;
        job.t = Math.min(job.end, job.t + dt);
        job.render(job.t);
      }
      // A target removed from the page: stop and clean up, as destroy() would.
      if (jobs.some((job) => job.detached)) return end(false);
      if (jobs.every((job) => job.t >= job.end)) return end(true);
    } catch (error) {
      console.error("pixel-printing:", error);
      return end(true);
    }
    frame = requestAnimationFrame(tick);
  };

  const begin = (job) => {
    if (ended || job.started || !job.seen || !job.isReady) return;
    job.started = true;
  };
  try {
    jobs.forEach((job) => {
      cleanups.push(job.prepare());
      job.render(0);
    });
  } catch (error) {
    console.error("pixel-printing:", error);
    end(false);
    return { finished, finish() {}, destroy() {}, setSpeed() {} };
  }
  jobs.forEach((job) =>
    job.ready.then(() => {
      job.isReady = true;
      begin(job);
    }),
  );

  if (start === "now") jobs.forEach((job) => (job.seen = true));
  else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const job = jobs.find((j) => j.node === e.target);
          if (!job) continue;
          job.seen = true;
          begin(job);
          io.unobserve(e.target);
        }
      },
      { threshold: 0.1 },
    );
    jobs.forEach((job) => io.observe(job.node));
    cleanups.push(() => io.disconnect());
  }
  frame = requestAnimationFrame(tick);

  return {
    finished,
    /** Jumps to the finished object and removes the overlay; onDone runs. */
    finish() {
      end(true);
    },
    /** Removes everything now, wherever the print is; onDone does not run. */
    destroy() {
      end(false);
    },
    /** Changes the speed while it runs: 2 is twice as fast. */
    setSpeed(value) {
      if (value > 0) speed = value;
    },
  };
}

function shouldSkip(nodes, pending) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The CSS fallback already showed the content: too late to print it.
  const fallbackShown = pending.some((node) =>
    node.getAnimations?.().some((a) => a.animationName === "pixel-printing-fallback" && a.playState === "finished"),
  );
  return reduced || fallbackShown || nodes.length === 0;
}

const rendered = (n) => n instanceof Element && n.isConnected && n.checkVisibility?.() !== false;

function normalize(targets, o) {
  const list = (Array.isArray(targets) ? targets : [targets]).filter(Boolean);
  const seen = new Set();
  return list.flatMap((t) => {
    const node = t instanceof Element ? t : t.el;
    if (!node?.parentElement || seen.has(node)) return [];
    seen.add(node);
    const given = t instanceof Element ? null : t.parts;
    const src = (t instanceof Element ? null : t.src) || imageSource(node);
    if (src) {
      const parsed = node.dataset.printParts ? parseParts(node.dataset.printParts) : [];
      const regions = Array.isArray(given) && given.length ? given : parsed.length ? parsed : autoParts();
      return [{ node, make: () => imageJob(node, regions, src, o) }];
    }
    const marked = node.querySelectorAll("[data-print-part]");
    const candidates = given ? [...given] : marked.length ? [...marked] : [...node.children];
    const nodes = [...new Set(candidates)].filter((n) => rendered(n) && node.contains(n) && n !== node);
    if (!nodes.length) {
      console.warn("pixel-printing: no parts to print in", node);
      return [];
    }
    return [{ node, nodes, make: () => elementJob(node, nodes, o) }];
  });
}

/**
 * Prints each target part by part: every part prints in apart from the others, with a glowing
 * print head, then they all assemble into the whole. A target is an image (an <img> or an element
 * with a CSS background image), split into percent regions, or any other element, whose
 * `[data-print-part]` descendants (or children) are the parts. `finished` always resolves.
 * `onDone` runs once when the print completes or `finish()` is called, never after `destroy()`.
 * @param {import("./pixel-printing").Target | import("./pixel-printing").Target[]} targets
 * @param {import("./pixel-printing").Options} [options]
 * @returns {import("./pixel-printing").PixelPrint}
 */
export function pixelPrint(targets, options = {}) {
  const o = {
    effect: EFFECTS.includes(options.effect) ? options.effect : "scan",
    direction: DIRECTIONS.includes(options.direction) ? options.direction : options.effect === "layers" ? "up" : "down",
    depth: options.depth === "3d" ? "3d" : "2d",
    spread: Number.isFinite(options.spread) && options.spread >= 0 ? options.spread : 0.3,
    color: options.color || "#5eead4",
  };
  const items = normalize(targets, o);
  const roots = (Array.isArray(targets) ? targets : [targets]).map((t) => (t instanceof Element ? t : t?.el));
  const pending = roots
    .filter((n) => n instanceof Element)
    .flatMap((n) => [n, ...n.querySelectorAll("[data-print-pending]")]);
  const unpend = () => pending.forEach((n) => n.removeAttribute("data-print-pending"));
  if (shouldSkip(items.map((i) => i.node), pending)) {
    unpend();
    options.onDone?.();
    return stopped;
  }
  const jobs = items.map((i) => i.make());
  const print = run(jobs, options);
  unpend();
  return print;
}

/** Prints every element with a `data-pixel-print` attribute, each on its own. */
export function pixelPrintAll(selector = "[data-pixel-print]", options) {
  return [...document.querySelectorAll(selector)].map((node) => pixelPrint(node, options));
}
