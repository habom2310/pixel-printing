/**
 * Part of an image, in percent of its width and height. `dx` and `dy` (percent of the image)
 * set where it prints before it assembles; by default parts start pushed out from the centre.
 * Live element parts set the same offset with `data-print-part="dx dy"`, in percent of the container.
 */
export type Part = { x: number; y: number; w: number; h: number; dx?: number; dy?: number };

export type Effect = "scan" | "dust" | "layers";

export type Target =
  | Element
  | {
      el: Element;
      /**
       * Image: `Part[]`, printed in order. Defaults to `data-print-parts`, then a 3 by 2 grid.
       * Element: `Element[]`, the parts. Defaults to `[data-print-part]` descendants, then its children.
       */
      parts?: Part[] | Element[];
      /** Image URL. Defaults to the img's current source or the element's background image. */
      src?: string;
    };

export type Options = {
  /**
   * "scan" (default): a print head sweeps down and pixels land along a ragged edge.
   * "dust": pixels rain in cell by cell (images only; elements use "scan").
   * "layers": the part builds up from the bottom, layer by layer.
   */
  effect?: Effect;
  /** "3d" tilts the parts in 3D, with thickness on images, and swings them flat as they land. Default "2d". */
  depth?: "2d" | "3d";
  /** How far parts start from their place, as a fraction of the object's smaller side. Default 0.3. */
  spread?: number;
  /** Hex or rgb() colour of the print head, outlines and fresh-print tint. Default "#5eead4". */
  color?: string;
  /** 2 plays twice as fast. Default 1 (about 5-6s for 6 parts). */
  speed?: number;
  /** "visible" (default) waits until a target scrolls into view; "now" starts at once. */
  start?: "visible" | "now";
  onDone?: () => void;
};

export type PixelPrint = {
  /** Resolves once every target is complete and the overlay is gone, however it ends. */
  finished: Promise<void>;
  /** Jump to the finished object; onDone runs. */
  finish(): void;
  /** Remove everything now (for example on unmount); onDone does not run. */
  destroy(): void;
  /** Change the speed while it runs: 2 is twice as fast. */
  setSpeed(speed: number): void;
};

export const EFFECTS: Effect[];
export function pixelPrint(targets: Target | Target[], options?: Options): PixelPrint;
export function pixelPrintAll(selector?: string, options?: Options): PixelPrint[];
export function parseParts(text: string): Part[];
export function autoParts(): Part[];
