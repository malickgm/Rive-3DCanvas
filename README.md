# Rive 3D

A data-bound 3D model viewer built inside the Rive editor — glTF loading, PBR
shading, skeletal animation and an orbit camera — rendered on Rive's GPU Canvas
from Luau scripts, plus a Next.js harness for testing whether it survives export
to a real runtime.

Everything here is driven through the [Rive MCP server](#driving-rive-over-mcp),
so the editor work is scripted rather than clicked.

---

## Status

| | |
| --- | --- |
| **In the Rive editor** | ✅ Working — loads `.glb`, skins, animates, orbits, fully data-bound |
| **Exported `.riv` on web** | ❌ Blocked — `context:shader()` and `context:viewModel()` return nil at runtime |

The editor-side build is complete and correct. Shipping it to a web app is
blocked by a runtime gap in `@rive-app/webgl2`, documented in
[BUG-REPORT-shader-viewmodel.md](BUG-REPORT-shader-viewmodel.md).

GPU Canvas itself **does** now work at runtime (landed in `@rive-app/webgl2`
2.42.0, having been entirely absent in 2.41.0). The remaining gap is script
access to shader assets and to the bound ViewModel.

---

## What it does

- Loads `.glb` from a **data-bound blob property** — swap models without touching code
- **Rigid node animation** and **skeletal skinning** (128-joint palette)
- **PBR shading** — Cook-Torrance GGX, key/fill/rim lights, hemisphere ambient
- **Orbit camera** with per-axis locks, driven by pointer, offset from a bindable rest pose
- **~40 ViewModel properties** covering transform, camera, material, spin and animation
- **Auto-fit** — any model frames correctly regardless of authored units

Every control is a ViewModel property, so the whole scene is drivable from a
state machine, a timeline, or app code. Nothing is hardcoded to one model.

---

## Repository layout

```
├── README.md                        you are here
├── 3d-Model-Instructions.md         the build: architecture, API notes, every gotcha
├── RUNTIME-INTEGRATION.md           shipping to an app: packages, embedding, test results
├── BUG-REPORT-shader-viewmodel.md   the runtime blocker, ready to file
├── CLAUDE.md                        project instructions for Claude Code
│
├── rive-3d-test/                    Next.js harness (see its own README)
│
├── rive-cli.js                      MCP-over-HTTP client — fallback if native tools are absent
├── GltfViewer.lua                   local copy of an early single-file viewer
├── CountdownTimer.lua               earlier scripting experiment
├── ChatList.lua                     earlier scripting experiment
├── TIMER-SPEC.md                    spec for the countdown experiment
└── PORTING-CHAT.md                  notes from porting the chat demo
```

**The `.lua` files here are copies, not the source of truth.** The live scripts
are inside the Rive file and the two will drift. Edit in Rive.

---

## Scripts in the Rive file

Layered so that GPU knowledge lives in exactly one place:

| Module | Protocol | Role |
| --- | --- | --- |
| `logo3d/Math3D` | utility | Vectors, quaternions, TRS, scene types, layout constants |
| `logo3d/GltfLoader` | utility | `.glb` → scene graph, local-space meshes, skins, animations |
| `logo3d/AnimationPlayer` | utility | Keyframe sampling, hierarchy composition, joint palettes |
| `logo3d/Camera3D` | utility | Orbit state → view/projection matrices |
| `logo3d/GPURenderer` | utility | **The only module that touches the GPU** |
| `logo3d/LogoViewport` | **layout** | The placed script that drives the frame |
| `PBR3D` | wgsl | Cook-Torrance GGX + vertex skinning |

Everything except `GPURenderer` is pure data — testable and swappable. Keep it
that way when extending.

Full architecture, UBO layouts and binding scheme:
[3d-Model-Instructions.md](3d-Model-Instructions.md).

---

## Getting started

### In Rive

1. Open the file in **Rive Early Access** — the MCP server is served by
   `RiveEarlyAccess.exe` on `127.0.0.1:9791`. The newer stable app opens no
   listening port, so MCP tooling cannot reach it.
2. Add your `.glb` to Assets, set `LogoScene.model` to it.
3. Drag `logo3d/LogoViewport` **onto the artboard on the canvas** — not onto a
   row in the Hierarchy panel, which silently does nothing.
4. Play. The script logs what it loaded:
   `[LogoViewport] loaded 'Bot.glb': 73 nodes, 1 skins, 6 animations`

### Testing an export

```bash
cd rive-3d-test
npm install
npm run dev
```

Drag your exported `.riv` onto the page. A five-step verdict panel reports
exactly which stage fails. See [rive-3d-test/README.md](rive-3d-test/README.md).

---

## Driving Rive over MCP

The editor exposes an MCP server with ~36 tools covering artboards, ViewModels,
data binding, layouts, animation and scripting.

`mcp__rive__*` tools are **deferred** — load them with ToolSearch first, then use
them natively. Only fall back to `rive-cli.js` if that genuinely returns nothing:

```bash
node rive-cli.js tools
node rive-cli.js schema <toolName>
node rive-cli.js call <toolName> <argsFile.json>
```

Confirm the server is up — `405` means running (the transport is POST-only):

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9791/mcp
```

---

## Things that will bite you

The full list is in [3d-Model-Instructions.md](3d-Model-Instructions.md); these
are the ones that cost the most time:

- **`listAssets` does not report blob assets.** Your `.glb` can be present and
  correctly assigned while the tool shows nothing. Verify via
  `listViewModelInstances` or `queryAsset` instead.
- **Scripts cannot be placed on an artboard over MCP** — the user must drag them,
  onto the canvas. Zero console entries means `init` has never run.
- **New ViewModel properties initialise to `0` / `false`.** A `scale` of 0 ships
  an invisible model. Set defaults explicitly on *every* instance — and the
  property key differs by type (number `575`, boolean `593`).
- **Buffer writes inside a render pass are silently dropped.** Upload everything
  before `beginRenderPass`. Symptom: parses fine, no errors, nothing draws.
- **The render phase has moved three times** in eight days (`drawCanvas` →
  `draw` → `drawCanvas` → `draw`). `LogoViewport` implements both and detects
  which one fires, so it survives the next flip.
- **Skinned bounds must be measured, not assumed.** A model whose rig has an
  import wrapper (Sketchfab/FBX) does not render at its raw `POSITION` values.

---

## Known limits

- **No zoom** — Rive exposes no scroll/wheel event (`Camera3D.dolly` is written, unwired)
- **`.glb` only** — a `.gltf` needs its sibling `.bin` from a filesystem
- **128 joints max**, clamped with a warning
- **No morph targets**
- Lighting is a fixed key/fill/rim rig; an environment map would need a second bind group
