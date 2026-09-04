# Shipping the Rive 3D scene to a real runtime

How to get the GPU-Canvas 3D viewer out of the Rive editor and into an app, and
how to find out whether that is even possible yet.

Companion to [3d-Model-Instructions.md](3d-Model-Instructions.md), which covers
the Rive-side build. Test app lives in [`rive-3d-test/`](rive-3d-test).

---

## ANSWERED — and it changed. Re-tested 2026-09-04

**GPU Canvas now works in the web runtime.**

| Check | 2.41.0 (Aug 27) | 2.42.0 (Sep 4) |
| --- | --- | --- |
| `.riv` loads | PASS | PASS |
| ViewModel binds | PASS | PASS |
| Luau script executes | PASS | PASS |
| **GPU Canvas available** | **FAIL** | **PASS** |

### What changed

On `@rive-app/webgl2` **2.41.0** the runtime emitted, once per frame:

```
context:gpuCanvas() requires a RIVE_CANVAS + RIVE_ORE build
```

`RIVE_CANVAS` / `RIVE_ORE` are compile flags for the C++ runtime — the GPU layer
simply was not built into the published WASM.

On **2.42.0** (published 2026-09-02) that string is **gone from the binary**.
Searching `rive.wasm` for it returns nothing; the only remaining `gpuCanvas`
error is a different, milder one:

```
context:gpuCanvas() requires a RenderContext — call setRenderContext() first
```

…and in practice the WebGL2 renderer satisfies that on its own. The test app now
reports **GPU Canvas available: PASS**.

So: **scripting and GPU Canvas both run on the web today.** Upgrade to
`@rive-app/react-webgl2` ≥ 4.34.0 (which pulls `@rive-app/webgl2` 2.42.0).

### Verifying a runtime yourself

The wasm binary is greppable, which is faster than a full round-trip:

```js
const s = fs.readFileSync('node_modules/@rive-app/webgl2/rive.wasm').toString('latin1');
s.indexOf('RIVE_CANVAS + RIVE_ORE')   // >= 0 means GPU Canvas is NOT compiled in
```

### But it still does not render — `context:shader()` and `context:viewModel()` return nil

GPU Canvas is available, and the Luau script runs. Two other pieces of `Context`
do not work in an exported file on the web:

| Call | Editor | Exported .riv on web |
| --- | --- | --- |
| `context:gpuCanvas()` | works | **works** (new in 2.42.0) |
| `context:shader("PBR3D")` | works | **nil** |
| `context:viewModel()` | works | **nil** |

Everything else checks out, which is what makes this a runtime gap rather than a
file problem:

- **The script runs and is ticked.** A retry counter printed `attempt 1`,
  `attempt 30` — so `advance` is being called and the lookup is genuinely
  failing, not merely being attempted once too early.
- **The shader is in the file.** `PBR3D` appears twice in the binary: once as a
  string constant inside the Luau script, and once as a **named asset** in the
  asset table (length-prefixed, followed by the `BTSR` shader blob).
- **The shader cross-compiles correctly.** From 2026-09 the editor translates
  WGSL to GLSL ES 300 at export (entry point renamed `vertexMain` → `main`).
  Both vertex and fragment blocks are present and well-formed, and the joint
  palette becomes a proper `std140` UBO:
  `layout(std140) uniform JointPalette_block_1Vertex { … }`.
- **It is not a GPU limit.** The palette needs 8 KB against a
  `MAX_UNIFORM_BLOCK_SIZE` of 65536; 2 uniform blocks against 12; 5 vertex
  attributes against 16.
- **It is not `autoBind`.** With `autoBind: false` the shader still fails, and
  shader lookup is unrelated to data binding either way.

So: the export is correct and the GPU layer is present, but the runtime does not
expose script-accessible **assets** or the script's **data context** for a loaded
file. That is the remaining blocker, and nothing in the Rive file can work around
it.

Worth reporting upstream — it is a precise, reproducible repro: a layout script
calling `context:shader(name)` on a shader that demonstrably exists in the
exported asset table.

### Still unknown

Only the **web** runtime has been tested. iOS, Android, Unity and Unreal each
ship their own build; check each before depending on it there.

### Note on the desktop app and MCP

The MCP server is served by **Rive Early Access** (`RiveEarlyAccess.exe`) on
`127.0.0.1:9791`. The updated stable app (`com.flutter.riveeditor`, installed
under `WindowsApps`) opens no listening TCP port at all, so MCP tooling cannot
reach it. Keep Early Access open for any MCP-driven work.

### There is no WebGPU package

Checked against npm on 2026-08-27:

| Package | Version | Renderer |
| --- | --- | --- |
| `@rive-app/webgl2` | 2.41.0 | **Rive Renderer** — same as the editor |
| `@rive-app/canvas` | 2.41.0 | CanvasRenderingContext2D |
| `@rive-app/webgl` | 2.37.0 | WebGL (older) |
| `@rive-app/react-webgl2` | 4.33.0 | React wrapper for the above |
| `@rive-app/webgpu` | **does not exist** | — |

`@rive-app/webgl2` is the one to use: it draws with the Rive Renderer, so it is
the only web package that could plausibly carry GPU Canvas. Rive's stated goal
is "write your shaders once and have them work everywhere", i.e. they translate
WGSL to the backend rather than requiring WebGPU in the browser.

---

## Are the assets embedded in the .riv?

Partly, and this is the thing that will bite. Every `assets_tool listAssets` call
during the build reported:

| Asset | `includeInExport` |
| --- | --- |
| `PBR3D` (wgsl shader) | **true** |
| `logo3d/*` (scripts) | false |
| `.glb` blobs | **false** |

Scripts at `false` appear to be fine — they compile into the file rather than
exporting as separate assets, and they demonstrably survived a copy/paste into
another project.

**The `.glb` at `false` is the risk.** In Rive that is the "referenced asset"
pattern: the bytes are not packed into the `.riv` and the runtime expects the
host app to supply them. Symptom would be a file that loads, runs the scripts,
and renders nothing, because `vm:getBlob("model")` comes back empty.

It is a per-asset toggle in the editor. Check it before blaming the code.

### The web runtime has no blob API

From `@rive-app/webgl2/rive.d.ts`, `ViewModelInstance` exposes:

```
number  string  boolean  color  trigger  enum  list  image  font  artboard  viewModel
```

**No `blob`.** So a `.glb` bound to a blob ViewModel property cannot be swapped
from JS the way a number or an image can. Two consequences:

1. The model must either be embedded in the `.riv`, or supplied through the
   asset loader.
2. Swapping models at runtime is not a solved problem through data binding.
   Multiple models means multiple artboards, or multiple `.riv` files.

### The asset-loader escape hatch

`FileAsset` carries `isImage` / `isFont` / `isAudio` — no blob flag — but it does
expose a generic `decode(bytes: Uint8Array)`. So an unembedded `.glb` may still
arrive in the `assetLoader` callback with `bytes.length === 0`, and be
satisfiable by fetching the file yourself and calling `asset.decode()`.

The test app implements exactly this. Drop a `.glb` at
`public/rive/model.glb` and it will try to feed it to any unembedded asset.
Whether Rive routes blob assets through `assetLoader` at all is one of the things
the test answers.

---

## The test app

```bash
cd rive-3d-test
npm run dev
```

Stack: Next.js 16.3.3 (App Router, Turbopack), React 19.2, Tailwind v4,
TypeScript, `@rive-app/react-webgl2` 4.33.0.

### To use it

1. `npm run dev`, open http://localhost:3000.
2. **Drag the exported `.riv` onto the page** — anywhere, or onto the Files panel.
3. Drop the `.glb` alongside it if it was not embedded, to test the
   unembedded-asset fallback.

Nothing is hardcoded and nothing is written to disk. Files are read into memory
via `FileReader`, so a reload clears them; dropping a new `.riv` bumps a
generation counter that remounts the viewer, because swapping `buffer` in place
is not reliable once the runtime has built its artboard and state machine.

Headers are sniffed on drop — `RIVE` for a `.riv`, `glTF` magic for a `.glb` — so
a mis-drop is caught in the panel rather than surfacing as a confusing parse
failure deep inside the Luau loader.

### What it reports

A four-step verdict panel, because the failure modes are silent and it matters
*which* step breaks:

| Check | What a FAIL means |
| --- | --- |
| 1 · `.riv` loads | wrong path, or the export never happened |
| 2 · ViewModel binds | no default instance, or `autoBind` did not resolve one |
| 3 · Luau script executes | **scripting does not run in this runtime** |
| 4 · No runtime errors | it runs but something is broken — read the console |

Step 3 is the one the whole exercise exists to answer. The script prints
`[LogoViewport] loaded '<name>': N nodes, N primitives, …` on a successful model
load, so the page patches `console` and surfaces anything script-related in a
panel under the canvas. **No output at all = the script never ran.**

The Assets section lists every asset the loader sees with its embedded size, and
highlights unembedded ones in amber. That answers the `includeInExport` question
empirically rather than by reading flags in the editor.

### Reading the result

- **All five PASS** → it works; re-test on your real target (iOS/Android/Unity),
  because a passing web test proves nothing about those.
- **3 FAIL** → scripting does not execute in this runtime at all.
- **3 PASS, 4 FAIL** → *the current state of the web runtime.* Scripting runs,
  GPU Canvas is not compiled in. The panel calls this out explicitly in red.
- **All PASS but canvas empty** → check the Assets panel; the model was probably
  not embedded and no `.glb` was dropped.

### Catching WASM errors requires patching console early

The `gpuCanvas()` failure initially went **unreported** while the page claimed
"no runtime errors". The Rive WASM binds its own reference to `console.error` at
module init (the usual Emscripten `var err = console.error.bind(console)`), so
patching console inside a React effect is far too late — the runtime already
holds the original.

`src/lib/consoleCapture.ts` therefore installs at **module load** and is imported
statically by `RiveViewerClient` before the runtime is dynamically imported. Any
harness that wants to see Rive's runtime errors needs the same ordering.

### Play the state machine explicitly

Without a `stateMachine` parameter the runtime plays the artboard's first linear
animation and warns:

> No `stateMachine` was specified, so the artboard's first linear animation is
> playing by default.

The name is not known until the file is parsed, so the app reads
`instance.stateMachineNames` in `onRiveReady` and calls `instance.play(name)`.
The Diagnostics panel shows what is actually playing.

---

## Driving the scene from app code

The `LogoScene` ViewModel is the entire API. Nothing in the app touches Luau or
the GPU renderer; it sets numbers, booleans and triggers.

```tsx
const { rive, RiveComponent } = useRive({
  src: "/rive/logo-streamer.riv",
  autoplay: true,
  autoBind: true,          // binds the default ViewModel instance
  layout: new Layout({ fit: Fit.Contain }),
  assetLoader,             // only needed for unembedded assets
});

const vmi = rive?.viewModelInstance ?? null;

// Typed per-property hooks
const { value, setValue } = useViewModelInstanceNumber("spinSpeed", vmi);
const { trigger } = useViewModelInstanceTrigger("animationPlay", vmi);
```

`useViewModelInstance{Number,String,Boolean,Trigger,Color,Enum,List,Image,Font}`
all exist. Numbers/strings/booleans return `{ value, setValue }`; triggers return
`{ trigger }`.

Reading is two-way: the script writes `animationName`, `animationCount`,
`animationDuration` and `animationTime` back out, so a clip picker and a scrubber
can be built without hardcoding anything about the model.

### Full property surface

See `src/lib/logoScene.ts` — it is the single source of truth for the control
list and mirrors the ViewModel. Groups: Animation, Spin, Transform, Camera,
Material & light.

---

## Next.js specifics worth knowing

- **`ssr: false` must live in a Client Component.** Next 16 rejects it in a
  Server Component, so `RiveViewerClient.tsx` is a thin `"use client"` wrapper
  around the `dynamic()` import. Without it the build fails outright.
- The Rive runtime touches WebGL and the DOM at import time, so it genuinely
  cannot be server-rendered — this is not cargo-culting.
- `.riv` files are binary. If you check them into git, add a `.gitattributes`
  marking them binary, or line-ending conversion will corrupt them.

---

## If it does not work

The fallback is not small. In rough order of effort:

1. **Wait for GPU Canvas to leave Early Access.** Least work, unknown timeline.
2. **Render 3D outside Rive** (three.js / WebGPU) and composite Rive 2D on top.
   Loses the single-file deliverable and the editor workflow.
3. **Bake to 2D.** Pre-render turntable frames from the model and drive them as a
   sprite sequence in Rive. Works everywhere, loses interactivity and orbit.

Option 3 is the one that ships today on any runtime, if the deadline is real.
