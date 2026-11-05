// pixel-printing: the parts of an image or element print in apart, then assemble into the whole.
// Dependency-free ES module. MIT licensed. See README.md and skills/pixel-printing/SKILL.md.

export const EFFECTS = ["scan", "dust", "layers"];

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

/** Printed height of each column of pixels. */
function heights(p, pt, effect) {
  if (effect === "layers") {
    const layer = CELL * 2;
    const filled = pt >= 1 ? p.h : Math.floor((pt * p.h) / layer) * layer;
    return p.jit.map(() => filled);
  }
  const reach = pt * (p.h + 4 * CELL);
  return p.jit.map((j) => Math.min(p.h, Math.max(0, Math.floor((reach - j * CELL) / CELL) * CELL)));
}

function clipFor(p, pt, hs, effect) {
  if (pt <= 0) return HIDDEN;
  if (pt >= 1) return null;
  if (effect === "layers") return `inset(${px(p.h - hs[0])} -${BLEED}px -${BLEED}px -${BLEED}px)`;
  const last = hs.length - 1;
  const pts = [`-${BLEED}px -${BLEED}px`, `${px(p.w + BLEED)} -${BLEED}px`];
  for (let c = last; c >= 0; c--) {
    const y = hs[c] >= p.h ? px(p.h + BLEED) : px(hs[c]);
    pts.push(`${c === last ? px(p.w + BLEED) : px((c + 1) * CELL)} ${y}`, `${c === 0 ? `-${BLEED}px` : px(c * CELL)} ${y}`);
  }
  return `polygon(${pts.join(", ")})`;
}

/** Sizes a part's effect canvas and resets its pixel columns after a resize. */
function sizePart(p, dpr) {
  const cols = Math.max(1, Math.ceil(p.w / CELL));
  if (p.jit?.length !== cols) {
    const rnd = random(p.i * 31 + 7);
    p.jit = Array.from({ length: cols }, () => Math.floor(rnd() * 4));
  }
  const width = Math.ceil((p.w + 2 * FX) * dpr);
  const height = Math.ceil((p.h + 2 * FX) * dpr);
  if (p.fx.width !== width || p.fx.height !== height) {
    Object.assign(p.fx, { width, height });
    Object.assign(p.fx.style, { width: px(p.w + 2 * FX), height: px(p.h + 2 * FX) });
    p.fxClear = false;
  }
  if (p.dust) {
    const w = Math.ceil(p.w * dpr);
    const h = Math.ceil(p.h * dpr);
    if (p.dust.canvas.width !== w || p.dust.canvas.height !== h) {
      Object.assign(p.dust.canvas, { width: w, height: h });
      const rnd = random(p.i * 97 + 3);
      const rows = Math.ceil(p.h / CELL);
      p.dust.cells = [];
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) p.dust.cells.push({ x, y, k: (y / rows) * 0.55 + rnd() * 0.45 });
      p.dust.cells.sort((a, b) => a.k - b.k);
      p.dust.drawn = 0;
    }
  }
}

/** Draws the outline, print head, fresh pixels and landing flash. Needs a 2D canvas; skipped without one. */
function paintFx(p, s, hs, effect, color, dpr, t) {
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
  if (head && p.dust) {
    const { cells } = p.dust;
    const fresh = Math.max(1, Math.floor(cells.length * 0.08));
    for (let c = Math.max(0, p.dust.drawn - fresh); c < p.dust.drawn; c++) {
      ctx.globalAlpha = 1 - (p.dust.drawn - c) / fresh;
      ctx.fillRect(cells[c].x * CELL, cells[c].y * CELL, CELL - 1, CELL - 1);
    }
  } else if (head) {
    const fromBottom = effect === "layers";
    const hy = fromBottom ? h - hs[0] : Math.min(h, s.pt * (h + 4 * CELL));
    // The head: a bright bar with a glow.
    ctx.globalAlpha = 0.95;
    ctx.shadowBlur = 12;
    ctx.fillRect(-4, hy - 1, w + 8, 2);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#fff";
    ctx.fillRect(-2, hy - 0.5, w + 4, 1);
    ctx.fillStyle = color;
    // Pixels it just laid down, flickering along the edge.
    const rnd = random(Math.floor(t * 30) * 7 + p.i);
    hs.forEach((filled, c) => {
      const y = fromBottom ? h - filled : filled - CELL;
      if (y < 0 || y >= h || rnd() < 0.35) return;
      ctx.globalAlpha = 0.4 + rnd() * 0.6;
      ctx.fillRect(c * CELL, y, CELL - 1, CELL - 1);
      if (!fromBottom && y >= CELL && rnd() < 0.3) ctx.fillRect(c * CELL, y - CELL, CELL - 1, CELL - 1);
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

/** Copies the newly printed cells of a dust part from the source image. */
function paintDust(p, pt, image, dpr) {
  const { dust } = p;
  const { cells, ctx } = dust;
  const n = Math.floor(easeInOut(pt) * cells.length);
  if (n === dust.drawn) return;
  if (n < dust.drawn) {
    ctx.clearRect(0, 0, dust.canvas.width, dust.canvas.height);
    dust.drawn = 0;
  }
  const sx = (p.r.x / 100) * image.naturalWidth;
  const sy = (p.r.y / 100) * image.naturalHeight;
  const fx = ((p.r.w / 100) * image.naturalWidth) / p.w;
  const fy = ((p.r.h / 100) * image.naturalHeight) / p.h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let c = dust.drawn; c < n; c++) {
    const x = cells[c].x * CELL;
    const y = cells[c].y * CELL;
    const cw = Math.min(CELL, p.w - x);
    const ch = Math.min(CELL, p.h - y);
    if (cw > 0 && ch > 0) ctx.drawImage(image, sx + x * fx, sy + y * fy, cw * fx, ch * fy, x, y, cw, ch);
  }
  dust.drawn = n;
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
  let effect = o.effect;
  job.ready =
    effect === "dust"
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
      sizePart(p, dpr);
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
      if (effect === "dust") {
        const canvas = el("canvas", { position: "absolute", inset: "0", width: "100%", height: "100%" }, p.group);
        const ctx = context(canvas);
        if (ctx) p.dust = { canvas, ctx, cells: [], drawn: 0 };
        else canvas.remove();
      }
      p.tile = p.dust ? p.dust.canvas : tile(src, r, {}, p.group);
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
    // Dust needs the decoded image; without it, it prints like scan.
    if (effect === "dust" && !image && job.started) {
      effect = "scan";
      parts.forEach((p) => {
        if (!p.dust) return;
        p.dust.canvas.remove();
        p.dust = null;
        p.tile = tile(src, p.r, {}, null);
        p.group.insertBefore(p.tile, p.fx);
      });
    }
    const dpr = dprNow();
    parts.forEach((p) => {
      const s = partState(p.i, t, tl);
      p.group.style.visibility = s.shown ? "" : "hidden";
      p.group.style.transform = moveTransform(p, s.k, o.depth) ?? "";
      const hs = heights(p, s.pt, effect);
      if (p.dust) {
        if (image) paintDust(p, s.pt, image, dpr);
        const clip = s.pt >= 1 ? p.rest : `inset(0 0 ${px((1 - s.pt) * p.h)} 0)`;
        p.copies.forEach((c) => (c.style.clipPath = clip));
        p.tile.style.clipPath = p.rest;
      } else {
        const clip = clipFor(p, s.pt, hs, effect) ?? p.rest;
        p.tile.style.clipPath = clip;
        p.copies.forEach((c) => (c.style.clipPath = clip));
      }
      p.copies.forEach((c) => (c.style.opacity = String(s.k)));
      p.tile.style.filter = p.tint(s.tint, "");
      paintFx(p, s, hs, effect, o.color, dpr, t);
    });
    // Whatever no part covers fades in once everything has landed.
    final.style.opacity = String(clamp01((t - tl.landed) / 0.4));
  };
  return job;
}

/** One element whose part elements print, then assemble, live in the page. */
function elementJob(container, nodes, o) {
  const tl = timeline(nodes.length);
  const effect = o.effect === "dust" ? "scan" : o.effect; // dust copies pixels from an image
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
      sizePart(p, dpr);
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
      const hs = heights(p, s.pt, effect);
      p.node.style.clipPath = clipFor(p, s.pt, hs, effect) ?? p.rest.clipPath;
      p.node.style.filter = s.tint > 0.005 ? p.tint(s.tint, p.base.filter) : p.rest.filter;
      // Focusable again once it starts to print, unless another print still hides it.
      const inert = s.pt <= 0;
      if (p.node.inert !== inert && (inert || (held.get(p.node)?.count ?? 0) <= 1)) p.node.inert = inert;
      paintFx(p, s, hs, effect, o.color, dpr, t);
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
