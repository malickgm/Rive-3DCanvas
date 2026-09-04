/**
 * Console capture that is installed at MODULE LOAD, deliberately.
 *
 * The Rive WASM module binds its own reference to `console.error` when it
 * initialises (the usual Emscripten `var err = console.error.bind(console)`
 * pattern). Anything that patches console *after* that — e.g. inside a
 * component effect — never sees runtime errors, which is exactly how the
 * `context:gpuCanvas() requires a RIVE_CANVAS + RIVE_ORE build` message went
 * unreported while the page cheerfully claimed "no runtime errors".
 *
 * So this module must be imported before the Rive runtime is. It is imported
 * statically by RiveViewerClient, which loads the runtime dynamically.
 */

export type CapturedLine = { kind: "info" | "warn" | "error"; text: string };

const MAX_LINES = 200;

/** Anything worth showing in the in-app console panel. */
const RELEVANT =
  /LogoViewport|GltfLoader|AnimationPlayer|logo3d|rive|wasm|shader|script|webgl|gpu|RIVE_/i;

let lines: CapturedLine[] = [];
const subscribers = new Set<() => void>();
let installed = false;

let emitScheduled = false;

/**
 * Notify subscribers on a microtask, never synchronously.
 *
 * The Rive runtime logs from inside its own load/render work, which React is
 * often in the middle of. A synchronous notify would re-enter
 * `useSyncExternalStore` mid-render and produce "Cannot update a component
 * while rendering a different component" — a warning caused entirely by the
 * act of observing, not by the thing being observed.
 */
function emit() {
  if (emitScheduled) return;
  emitScheduled = true;
  queueMicrotask(() => {
    emitScheduled = false;
    for (const fn of subscribers) fn();
  });
}

function record(kind: CapturedLine["kind"], args: unknown[]) {
  const text = args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ")
    .trim();

  if (!text || !RELEVANT.test(text)) return;

  // The GPU-canvas failure is emitted once per frame; collapse the repeats so
  // the panel stays readable instead of scrolling forever.
  const last = lines[lines.length - 1];
  if (last && last.text === text) return;

  lines = [...lines.slice(-(MAX_LINES - 1)), { kind, text }];
  emit();
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args: unknown[]) => {
    original.log(...args);
    record("info", args);
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    record("warn", args);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    record("error", args);
  };
}

install();

export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function getLines(): CapturedLine[] {
  return lines;
}

export function clearLines() {
  lines = [];
  emit();
}

/**
 * Rive's own signal that GPU Canvas is unavailable.
 *
 * Two distinct wordings have shipped:
 *   2.41.0  "context:gpuCanvas() requires a RIVE_CANVAS + RIVE_ORE build"
 *           — the GPU layer was not compiled into the WASM at all.
 *   2.42.0  "context:gpuCanvas() requires a RenderContext — call
 *           setRenderContext() first" — compiled in, but not set up.
 *
 * Matching `gpuCanvas()` covers both and anything similar in future.
 */
export function hasGpuCanvasFailure(list: CapturedLine[]): boolean {
  return list.some((l) => /RIVE_ORE|RIVE_CANVAS|gpuCanvas\(\)|setRenderContext/i.test(l.text));
}

export function hasScriptOutput(list: CapturedLine[]): boolean {
  return list.some((l) => /\[LogoViewport\]|\[GltfLoader\]/.test(l.text));
}
