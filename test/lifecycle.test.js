import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const { window } = dom;
let reduced = false;
let holdView = false;
const observers = [];
const draws = [];
// A 2D context that accepts every call, so the effect code runs; drawImage calls are recorded.
const fakeContext = () =>
  new Proxy(
    {},
    {
      get: (_, key) => (key === "drawImage" ? (...args) => draws.push(args) : () => {}),
      set: () => true,
    },
  );
window.HTMLCanvasElement.prototype.getContext = fakeContext;
window.HTMLImageElement.prototype.decode = () => Promise.resolve();
Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  Node: window.Node,
  Image: window.Image,
  HTMLImageElement: window.HTMLImageElement,
  getComputedStyle: window.getComputedStyle,
  innerWidth: 1280,
  innerHeight: 800,
  requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 4),
  cancelAnimationFrame: (id) => clearTimeout(id),
  matchMedia: () => ({ matches: reduced }),
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  // Everything is in view at once, unless a test holds the view to scroll by hand.
  IntersectionObserver: class {
    constructor(cb) {
      this.cb = cb;
      this.nodes = [];
      observers.push(this);
    }
    observe(node) {
      this.nodes.push(node);
      if (!holdView) queueMicrotask(() => this.cb([{ target: node, isIntersecting: true }]));
    }
    scrollIntoView() {
      this.cb(this.nodes.map((target) => ({ target, isIntersecting: true })));
    }
    unobserve() {}
    disconnect() {}
  },
});
const { pixelPrint, pixelPrintAll } = await import("../src/pixel-printing.js");

const leftovers = () => document.querySelectorAll("[aria-hidden]").length;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function image(parent = document.body) {
  const img = document.createElement("img");
  img.src = "http://localhost/robot.png";
  img.setAttribute("data-print-pending", "");
  img.dataset.printParts = "0 0 50 50, 50 0 50 50 10 -20, 0 50 100 50";
  parent.appendChild(img);
  return img;
}
function widget() {
  document.body.innerHTML = `
    <div id="w">
      <header data-print-part style="transform: rotate(1deg); clip-path: circle(80%)">Queue</header>
      <div data-print-part="0 -40" data-print-pending>Stats</div>
      <button data-print-part>Start</button>
      <p>Not a part</p>
    </div>`;
  return { container: document.getElementById("w"), parts: [...document.querySelectorAll("[data-print-part]")] };
}

beforeEach(() => {
  document.body.innerHTML = "";
  reduced = false;
  holdView = false;
  observers.length = 0;
  draws.length = 0;
});

test("an image run completes, calls onDone once and restores everything", async () => {
  const wrap = document.body.appendChild(document.createElement("div"));
  const img = image(wrap);
  img.style.opacity = "0.9";
  let calls = 0;
  const print = pixelPrint(img, { start: "now", speed: 50, onDone: () => calls++ });
  assert.ok(leftovers() > 0, "overlay added");
  assert.equal(img.style.opacity, "0", "the original hides while its parts print");
  assert.equal(wrap.style.position, "relative");
  assert.equal(img.hasAttribute("data-print-pending"), false);
  await print.finished;
  assert.equal(calls, 1);
  assert.equal(leftovers(), 0);
  assert.equal(wrap.style.position, "");
  assert.equal(img.style.opacity, "0.9");
});

test("finish() mid-run ends at once and calls onDone once", async () => {
  let calls = 0;
  const print = pixelPrint(image(), { start: "now", onDone: () => calls++ });
  await wait(40);
  print.finish();
  print.finish();
  await print.finished;
  assert.equal(calls, 1);
  assert.equal(leftovers(), 0);
});

test("destroy() mid-run resolves finished without onDone", async () => {
  let calls = 0;
  const print = pixelPrint(image(), { start: "now", onDone: () => calls++ });
  await wait(40);
  print.destroy();
  await print.finished;
  await wait(30);
  assert.equal(calls, 0);
  assert.equal(leftovers(), 0);
});

test("destroy() while waiting to scroll into view resolves finished without onDone", async () => {
  holdView = true;
  let calls = 0;
  const print = pixelPrint(image(), { onDone: () => calls++ });
  print.destroy();
  await print.finished;
  assert.equal(calls, 0);
  assert.equal(leftovers(), 0);
});

test("starts when the target scrolls into view", async () => {
  holdView = true;
  let calls = 0;
  const print = pixelPrint(image(), { speed: 50, onDone: () => calls++ });
  await wait(40);
  assert.equal(calls, 0);
  observers[0].scrollIntoView();
  await print.finished;
  assert.equal(calls, 1);
});

test("reduced motion shows the result and adds nothing", async () => {
  reduced = true;
  let calls = 0;
  const img = image();
  await pixelPrint(img, { onDone: () => calls++ }).finished;
  assert.equal(calls, 1);
  assert.equal(leftovers(), 0);
  assert.equal(img.hasAttribute("data-print-pending"), false);
  assert.equal(img.style.opacity, "");
});

test("bad input is ignored instead of throwing", async () => {
  await pixelPrint(null).finished;
  await pixelPrint([null, undefined]).finished;
  const print = pixelPrint(image(), { start: "now", speed: 0, effect: "nope", depth: "4d", spread: -1 });
  print.finish();
  await print.finished;
  assert.equal(leftovers(), 0);
});

test("3D depth gives image parts thickness and a tilt", async () => {
  const img = image();
  const print = pixelPrint(img, { start: "now", depth: "3d", speed: 0.2 });
  const layer = img.nextElementSibling;
  // 3 parts, each with 3 thickness copies, a tile and an effect canvas; plus the final tile and the filters.
  assert.equal(layer.querySelectorAll(":scope > div > div").length, 3 * 4);
  await wait(60);
  assert.match(layer.children[1].style.transform, /perspective\(1000px\).*rotateX/);
  print.destroy();
  await print.finished;
});

test("dust copies pixels from the decoded image", async () => {
  const natural = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, "naturalWidth");
  Object.defineProperty(window.HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 600 });
  Object.defineProperty(window.HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => 400 });
  const img = image();
  // jsdom has no layout: give the image a size so parts have pixels.
  img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200 });
  try {
    const print = pixelPrint(img, { start: "now", effect: "dust", speed: 5 });
    await print.finished;
    assert.ok(draws.length > 0, "cells were drawn from the image");
    assert.equal(leftovers(), 0);
  } finally {
    Object.defineProperty(window.HTMLImageElement.prototype, "naturalWidth", natural);
    delete window.HTMLImageElement.prototype.naturalHeight;
  }
});

test("dust prints like scan when the image cannot be decoded", async () => {
  const img = image();
  const print = pixelPrint(img, { start: "now", effect: "dust", speed: 0.5 });
  await wait(60);
  const layer = img.nextElementSibling;
  assert.equal(layer.querySelectorAll(":scope > div > canvas").length, 3, "only the effect canvases are left");
  assert.equal(draws.length, 0);
  print.destroy();
  await print.finished;
});

test("element mode hides parts, prints them and restores their styles", async () => {
  const { container, parts } = widget();
  parts[2].inert = false;
  let calls = 0;
  const print = pixelPrint(container, { start: "now", speed: 50, onDone: () => calls++ });
  assert.ok(parts.every((p) => p.inert), "hidden parts leave the tab order");
  assert.equal(parts[1].style.clipPath, "inset(0 0 100% 0)");
  assert.equal(parts[1].hasAttribute("data-print-pending"), false);
  assert.equal(container.querySelector("p").style.clipPath, "", "unmarked children are left alone");
  await print.finished;
  assert.equal(calls, 1);
  assert.equal(leftovers(), 0);
  assert.equal(parts[0].style.transform, "rotate(1deg)");
  assert.equal(parts[0].style.clipPath, "circle(80%)");
  assert.equal(parts[1].style.clipPath, "");
  assert.equal(parts[1].style.filter, "");
  assert.ok(parts.every((p) => !p.inert));
  assert.equal(container.style.position, "");
});

test("element mode uses the children when no part is marked", async () => {
  document.body.innerHTML = `<div id="w"><h2>Title</h2><p>Body</p></div>`;
  const container = document.getElementById("w");
  const print = pixelPrint(container, { start: "now", speed: 0.2 });
  assert.ok([...container.children].slice(0, 2).every((c) => c.style.clipPath === "inset(0 0 100% 0)"));
  print.destroy();
  await print.finished;
  assert.ok([...container.children].every((c) => c.style.clipPath === ""));
});

test("element mode destroy() mid-run restores the parts", async () => {
  const { container, parts } = widget();
  const print = pixelPrint(container, { start: "now", speed: 0.5 });
  await wait(80);
  print.destroy();
  await print.finished;
  assert.equal(parts[0].style.transform, "rotate(1deg)");
  assert.equal(parts[2].style.transform, "");
  assert.equal(parts[2].style.clipPath, "");
  assert.equal(leftovers(), 0);
});

test("a second print over hidden parts does not keep them hidden", async () => {
  const { container, parts } = widget();
  const first = pixelPrint(container, { start: "now", speed: 0.2 });
  const second = pixelPrint(container, { start: "now", speed: 0.2 });
  first.destroy();
  assert.equal(parts[2].inert, true, "still inert for the second print");
  second.finish();
  await Promise.all([first.finished, second.finished]);
  assert.equal(parts[2].style.clipPath, "");
  assert.equal(parts[0].style.clipPath, "circle(80%)");
  assert.ok(!parts[2].inert);
});

test("an element with nothing to print resolves at once", async () => {
  document.body.innerHTML = `<div id="w"></div>`;
  const warn = console.warn;
  console.warn = () => {};
  try {
    let calls = 0;
    await pixelPrint(document.getElementById("w"), { onDone: () => calls++ }).finished;
    assert.equal(calls, 1);
  } finally {
    console.warn = warn;
  }
});

test("setSpeed changes a running print", async () => {
  const print = pixelPrint(image(), { start: "now", speed: 0.01 });
  print.setSpeed(80);
  print.setSpeed(-1);
  const r = await Promise.race([print.finished.then(() => "done"), wait(3000).then(() => "slow")]);
  assert.equal(r, "done");
});

test("pixelPrintAll prints every marked target", async () => {
  image().setAttribute("data-pixel-print", "");
  image().setAttribute("data-pixel-print", "");
  const prints = pixelPrintAll(undefined, { start: "now" });
  assert.equal(prints.length, 2);
  prints.forEach((p) => p.finish());
  await Promise.all(prints.map((p) => p.finished));
  assert.equal(leftovers(), 0);
});

test("finished resolves even when onDone throws", async () => {
  const errors = [];
  const print = pixelPrint(image(), {
    start: "now",
    onDone: () => {
      throw new Error("boom");
    },
  });
  try {
    print.finish();
  } catch (e) {
    errors.push(e);
  }
  await print.finished;
  assert.equal(errors.length, 1);
  assert.equal(leftovers(), 0);
});

test("a target removed mid-run stops without onDone and cleans up", async () => {
  const wrap = document.body.appendChild(document.createElement("div"));
  const img = image(wrap);
  let calls = 0;
  const print = pixelPrint(img, { start: "now", speed: 0.2, onDone: () => calls++ });
  await wait(30);
  img.remove();
  await print.finished;
  assert.equal(calls, 0);
  assert.equal(leftovers(), 0);
  assert.equal(img.style.opacity, "");
});

test("element mode turns off CSS transitions while printing and restores them", async () => {
  const { container, parts } = widget();
  parts[1].style.transition = "transform 0.3s";
  const print = pixelPrint(container, { start: "now", speed: 0.2 });
  assert.equal(parts[1].style.transition, "none");
  print.finish();
  await print.finished;
  assert.equal(parts[1].style.transition, "transform 0.3s");
});

test("corner parts of a rounded image keep its corners; percent radii are skipped", async () => {
  const img = image();
  img.style.borderRadius = "12px";
  const print = pixelPrint(img, { start: "now", speed: 0.2 });
  const tiles = [...img.nextElementSibling.querySelectorAll(":scope > div > div")];
  print.finish();
  await print.finished;
  assert.ok(tiles.length === 3);

  const round = image();
  round.style.borderRadius = "50%";
  const second = pixelPrint(round, { start: "now", speed: 50 });
  await second.finished;
  assert.equal(leftovers(), 0);
});

test("pending is cleared on a target that has nothing to print", async () => {
  document.body.innerHTML = `<div id="w" data-print-pending></div>`;
  const warn = console.warn;
  console.warn = () => {};
  try {
    await pixelPrint(document.getElementById("w")).finished;
    assert.equal(document.getElementById("w").hasAttribute("data-print-pending"), false);
  } finally {
    console.warn = warn;
  }
});

test("an array of targets waits for each to scroll into view", async () => {
  holdView = true;
  const a = image();
  const { container } = (() => {
    const div = document.body.appendChild(document.createElement("div"));
    div.innerHTML = "<p>One</p><p>Two</p>";
    return { container: div };
  })();
  let calls = 0;
  const print = pixelPrint([a, container], { speed: 50, effect: "layers", depth: "3d", onDone: () => calls++ });
  await wait(40);
  assert.equal(calls, 0);
  observers[0].scrollIntoView();
  await print.finished;
  assert.equal(calls, 1);
  assert.equal(leftovers(), 0);
});

const { EFFECTS, DIRECTIONS } = await import("../src/pixel-printing.js");

/** A widget whose parts have a real size, since jsdom has no layout. */
function sizedWidget() {
  const { container, parts } = widget();
  container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 160, right: 200, bottom: 160 });
  parts.forEach((p, i) => {
    p.getBoundingClientRect = () => ({ left: 10, top: 10 + i * 50, width: 80, height: 40, right: 90, bottom: 50 + i * 50 });
  });
  return { container, parts };
}

test("every effect and direction completes and restores, in both modes", async () => {
  for (const effect of EFFECTS)
    for (const direction of DIRECTIONS) {
      const img = image();
      const { container, parts } = sizedWidget();
      document.body.appendChild(img);
      const print = pixelPrint([img, container], { start: "now", speed: 40, effect, direction, depth: "3d" });
      await print.finished;
      assert.equal(leftovers(), 0, `${effect} ${direction}`);
      assert.equal(parts[2].style.clipPath, "", `${effect} ${direction}`);
      assert.equal(img.style.opacity, "", `${effect} ${direction}`);
    }
});

test("pattern effects print live elements cell by cell through a clip-path", async () => {
  const { container, parts } = sizedWidget();
  const print = pixelPrint(container, { start: "now", speed: 0.6, effect: "noise" });
  let clip = "";
  for (let i = 0; i < 200 && !clip.startsWith("polygon(0 0,"); i++) {
    await wait(10);
    clip = parts[0].style.clipPath;
  }
  assert.match(clip, /^polygon\(0 0, [\d.]+px [\d.]+px/, "a run of printed cells");
  print.destroy();
  await print.finished;
});

test("scan follows the direction", async () => {
  const clipAt = async (direction) => {
    const { container, parts } = sizedWidget();
    const print = pixelPrint(container, { start: "now", speed: 0.6, direction });
    let clip = "";
    for (let i = 0; i < 200 && !clip.startsWith("polygon"); i++) {
      await wait(10);
      clip = parts[0].style.clipPath;
    }
    print.destroy();
    await print.finished;
    return clip.match(/^polygon\(([^,]+), ([^,]+),/).slice(1);
  };
  // The first two points are the corners of the edge printing starts from.
  assert.deepEqual(await clipAt("down"), ["-40px -40px", "120px -40px"]);
  assert.deepEqual(await clipAt("right"), ["-40px -40px", "-40px 80px"]);
  assert.deepEqual(await clipAt("left"), ["120px -40px", "120px 80px"]);
  assert.deepEqual(await clipAt("up"), ["-40px 80px", "120px 80px"]);
});
