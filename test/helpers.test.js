import { test } from "node:test";
import assert from "node:assert/strict";
import { autoParts, parseParts } from "../src/pixel-printing.js";

test("parseParts reads comma or semicolon separated parts, with an optional offset", () => {
  assert.deepEqual(parseParts("0 0 10 100, 12 4.5 58 5 -10 20;  70 4 30 13"), [
    { x: 0, y: 0, w: 10, h: 100 },
    { x: 12, y: 4.5, w: 58, h: 5, dx: -10, dy: 20 },
    { x: 70, y: 4, w: 30, h: 13 },
  ]);
});

test("parseParts skips malformed parts", () => {
  assert.deepEqual(parseParts("1 2 3, a b c d, 1 2 3 4, 1 2 3 4 5,"), [{ x: 1, y: 2, w: 3, h: 4 }]);
});

test("autoParts tiles the whole image", () => {
  const parts = autoParts();
  assert.equal(parts.length, 6);
  for (const { x, y, w, h } of parts) assert.ok(x >= 0 && y >= 0 && x + w <= 100.0001 && y + h <= 100);
});
