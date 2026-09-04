# Rive 3D runtime test

A Next.js harness that answers one question: **does the GPU-Canvas 3D scene still
work once exported to a `.riv` and loaded by a real runtime?**

Part of the [Rive 3D](../README.md) project. Findings live in
[../RUNTIME-INTEGRATION.md](../RUNTIME-INTEGRATION.md).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000 and **drag your `.riv` onto the page** — anywhere, or
onto the Files panel. Add the `.glb` alongside it if it was not embedded.

Files are read into memory, never written to disk, so a reload clears them.
Dropping a new `.riv` remounts the runtime, so you can re-export and re-test
without restarting the dev server.

For repeatable runs there is an optional query param:

```
/?src=/rive/test.riv&glb=/rive/model.glb
/?src=/rive/test.riv&autobind=0        disable autoBind to isolate binding issues
```

## What it reports

Five verdicts, because these failures are silent and *which* stage breaks is the
whole answer:

| Check | A FAIL means |
| --- | --- |
| 1 · `.riv` loads | wrong file, or the export never happened |
| 2 · ViewModel binds | no default instance, or `autoBind` did not resolve one |
| 3 · Luau script executes | scripting does not run in this runtime |
| 4 · GPU Canvas available | the GPU layer is missing or unavailable |
| 5 · No other runtime errors | something else broke — read the console panel |

Plus:

- **Assets** — every asset the loader sees, with embedded byte size, unembedded
  ones flagged amber. Answers "did my `.glb` actually ship inside the file?"
  empirically rather than by reading editor flags.
- **Script console** — the Luau script's own `print` output, captured from the
  browser console. A working file prints
  `[LogoViewport] loaded '<name>': N nodes, N skins, N animations`.
- **Live controls** — every `LogoScene` property, driven through the typed
  `useViewModelInstance*` hooks.

## Current result

Checks 1–4 pass on `@rive-app/webgl2` 2.42.0. The script runs and GPU Canvas is
available, but `context:shader()` and `context:viewModel()` return nil inside an
exported file, so nothing renders. See
[../BUG-REPORT-shader-viewmodel.md](../BUG-REPORT-shader-viewmodel.md).

## Stack

Next.js 16.3.3 · React 19.2 · Tailwind v4 · TypeScript ·
`@rive-app/react-webgl2` 4.34.0 (the Rive Renderer — there is no WebGPU package).

## Files

| Path | Role |
| --- | --- |
| `src/lib/logoScene.ts` | ViewModel contract — mirrors the Rive file |
| `src/lib/riveFiles.ts` | File reading, classification, header sniffing |
| `src/lib/consoleCapture.ts` | Console patching, installed at module load |
| `src/components/RiveViewerClient.tsx` | File state, page-wide drop, `ssr: false` boundary |
| `src/components/RiveViewer.tsx` | Canvas, asset loader, diagnostics, layout |
| `src/components/DropPanel.tsx` | Drop zone and loaded-file list |
| `src/components/Controls.tsx` | One component per property type |

## Two non-obvious implementation notes

**Console capture must install at module load.** The Rive WASM binds its own
`console.error` reference when it initialises, so patching console inside a React
effect never sees runtime errors — which is exactly how a GPU-canvas failure went
unreported while the page claimed "no runtime errors". `consoleCapture.ts` is
imported statically by `RiveViewerClient` before the runtime is imported
dynamically.

**Notifications must be deferred.** Rive logs from inside its own load and render
work, which React is often mid-render through. Notifying `useSyncExternalStore`
synchronously produces "Cannot update a component while rendering a different
component" — a warning caused entirely by the act of observing. All capture
notifications and runtime callbacks flush on a microtask.
