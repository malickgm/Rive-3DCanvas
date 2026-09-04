# 3D model viewer in Rive — build notes

A data-bound 3D model viewer rendered on Rive's GPU Canvas from a `.glb`, with
orbit camera, full TRS controls, rigid node animation and skeletal skinning.

Built 2026-08-07 against the Rive Early Access editor via its MCP server, and
updated through 2026-08-27.

Everything below is what actually worked, including the things that wasted time.

For getting this into an app, see [RUNTIME-INTEGRATION.md](RUNTIME-INTEGRATION.md).

> **Runtime status (re-tested 2026-09-04): it works on the web now.**
> `@rive-app/webgl2` **2.42.0** compiles GPU Canvas into the WASM — the
> `RIVE_CANVAS + RIVE_ORE` error present in 2.41.0 is gone from the binary, and
> the test app reports scripting *and* GPU Canvas both PASS. Upgrade to
> `@rive-app/react-webgl2` ≥ 4.34.0. Details in RUNTIME-INTEGRATION.md.

---

## What exists in the file

### Scripts

| Path | Protocol | Role |
| --- | --- | --- |
| `logo3d/Math3D` | utility | Vec3, quaternion (slerp, →Mat4), TRS compose, scene types, vertex/joint constants |
| `logo3d/GltfLoader` | utility | `.glb` → scene graph, local-space meshes, skins, animations |
| `logo3d/AnimationPlayer` | utility | Keyframe sampling + hierarchy composition + joint palettes |
| `logo3d/Camera3D` | utility | Orbit state → view/projection matrices |
| `logo3d/GPURenderer` | utility | **The only module that touches the GPU** |
| `logo3d/LogoViewport` | **layout** | The placed script that drives the frame |
| `PBR3D` | wgsl | Cook-Torrance GGX + vertex skinning |

The layering is deliberate: everything except `GPURenderer` is pure data and stays
testable and swappable. Keep it that way when extending.

> `GlbLoader` was the original loader and **no longer exists**. It flattened node
> transforms into vertex data, which made animation impossible. `GltfLoader`
> replaced it under a new name deliberately — recreating a script over a
> just-deleted name yields an empty file.

### Scene

```
Artboard
└── LogoStage          LayoutComponent, fills artboard, no fill paint
    └── LogoViewport   ScriptedLayout  ← the script instance
```

`LogoStage` is a convenience container, **not** required — a layout script sizes
itself to whatever slot it lands in, so dropping it directly under `Artboard`
works too.

### ViewModel `LogoScene`

Bound to the artboard via instance `SceneInstance`. This is also the entire API
surface for app code — see RUNTIME-INTEGRATION.md.

**Model and material**

| Property | Type | Default | Effect |
| --- | --- | --- | --- |
| `model` | blob | — | the `.glb` asset to render |
| `showTextures` | boolean | true | glTF materials + maps, vs neutral clay |
| `metallic` | number | 0.1 | clay only (`showTextures` off) |
| `roughness` | number | 0.45 | clay only (`showTextures` off) |
| `lightIntensity` | number | 1.0 | overall light level |

**Transform** — position in *model radii*, since every model is auto-fitted to
radius 1. Rotation in degrees, applied X → Y → Z (Blender's default XYZ Euler).

| Property | Type | Default |
| --- | --- | --- |
| `modelScale` | number | 1.0 |
| `positionX/Y/Z` | number | 0 |
| `rotationX/Y/Z` | number | 0 |
| `scaleX/Y/Z` | number | **1** |

**Spin** — animated rotation applied on top of the static rotation.

| Property | Type | Default | Effect |
| --- | --- | --- | --- |
| `spinEnabled` | boolean | **true** | master on/off; pauses in place, does not reset |
| `spinSpeed` | number | 45 | degrees/sec; negative reverses |
| `spinAxis` | number | 0 | **0 = X, 1 = Y, 2 = Z** |

**Camera** — an orbit rig. Bound values are the *rest pose*; pointer drag
accumulates a separate offset on top, so keyframes and dragging do not fight.

| Property | Type | Default |
| --- | --- | --- |
| `cameraYaw` | number | 22 (degrees) |
| `cameraPitch` | number | 14 (degrees, clamped ±85) |
| `cameraDistance` | number | 3.6 (model radii, clamped 1.15–14) |
| `cameraTargetX/Y/Z` | number | 0 |
| `cameraFOV` | number | 25 (degrees, clamped 5–120) |
| `orbitEnabled` | boolean | true |
| `orbitLockYaw` | boolean | false |
| `orbitLockPitch` | boolean | false |

`orbitLockPitch` alone gives turntable behaviour — the usual choice for a logo.
A locked axis swallows only that component of a drag, so the unlocked axis still
tracks the pointer 1:1 diagonally.

**Animation** — the script *writes back* the bottom four.

| Property | Type | Default | Effect |
| --- | --- | --- | --- |
| `animationIndex` | number | 1 | **0 = rest pose**, 1..N selects a clip |
| `animationPlaying` | boolean | true | play / pause |
| `animationSpeed` | number | 1 | negative plays backwards |
| `animationLoop` | boolean | true | loop, or hold on the last frame |
| `animationPlay` | trigger | — | restart the clip and resume — the event hook |
| `animationTime` | number | *written* | current time, every frame; bind a scrubber |
| `animationDuration` | number | *written* | on selection change |
| `animationCount` | number | *written* | on load |
| `animationName` | string | *written* | on selection change |

---

## Setting this up in a new file

1. **Create the ViewModel first** and `bindViewModelToArtboard` before writing
   the scripts.
2. Create the utility scripts, then the shader, then `LogoViewport` last (it
   `require`s the others).
3. `script_diagnostics` with **no path** — must return `[]`.
4. Add the `.glb` to Assets, set `SceneInstance.model` to it.
5. **Drag `LogoViewport` onto the artboard on the canvas.** Cannot be done over
   MCP.
6. Confirm via `read_console`.

---

## Gotchas that cost real time

### `assets_tool listAssets` does not report blob assets

This caused a long false diagnosis. The `.glb` was present and correctly assigned
the whole time, but `listAssets` returned only scripts and the shader.

Verify a blob two other ways instead:

```
viewmodel_editor listViewModelInstances   →  model property shows the asset id
assets_tool      queryAsset <id>          →  {"type":"blob","name":"…glb"}
```

`typeFilter` has no `blob` option either, despite the description mentioning them.

### Scripts cannot be placed on an artboard over MCP

`component_editor addComponents` with a script id returns `Component not found`.
Confirmed, not folklore.

**Drag onto the canvas — the drawing surface — not onto a row in the Hierarchy
panel.** Dropping on a hierarchy row silently does nothing. The success signal is
a new `ScriptedLayout` appearing in the hierarchy; if the hierarchy does not
change, the drop did not land regardless of what the cursor did.

Diagnose with three checks: the parent has a `ScriptedLayout` child,
`find_objects` finds it, and **`read_console` has entries — zero entries means
`init` has never run.**

### `script_diagnostics` with a path always fails

`script_diagnostics logo3d/Math3D` → `No script at …`, for every path form tried.
Calling it with **no argument** works and covers the whole workspace. Use that.

`text_editor` *does* accept the same paths, so scripts are readable and editable
immediately after `manage_scripts create`.

### New ViewModel properties initialise to zero/false

Adding a property gives every existing instance `0` / `false` / `""`. For
`modelScale`, `scaleX/Y/Z` and `spinEnabled` that ships a broken starter — a zero
scale is an invisible model, and `spinEnabled = false` looks like broken code.

Set them explicitly, on **every** instance including auto-created ones:

```
query_property_keys <instancePropertyId>
set_property_values { "<id>": { "<key>": <value> } }
```

**The property key differs by type:**

| Instance property type | `propertyvalue` key |
| --- | --- |
| number | **575** |
| boolean | **593** |

Using 575 on a boolean returns `unknown_property`. Always
`query_property_keys` first rather than assuming.

### The MCP follows the editor's *active* file, and it can change mid-task

An `addProperties` call went out against a different project's ViewModel id after
the active file switched, and **silently no-op'd** — returning `success` with the
old structure. Verify the target (`list_artboards`, or read the echoed response)
before a batch of writes, and re-verify if the user mentions switching files.

### The WGSL shader does not survive copy/paste between projects

Copying an artboard carried the scripts, the ViewModel with all instance values,
and the `.glb` blob — but **not the shader**. Scripts are reachable from the
pasted artboard through the `ScriptedLayout`, and the blob through the ViewModel
binding, so Rive pulls those in as dependencies. The shader is only referenced by
a *string* inside `GPURenderer` (`context:shader("PBR3D")`), so there is no link
to follow.

Generalises: **anything a script looks up by name will not travel with a paste.**
Same applies to `context:blob("name")` and `context:image("name")`.

Symptom: `[LogoViewport] shader 'PBR3D' was not found in this file`.

### The artboard silently loses its ViewModel binding

Happened twice across structural changes. Symptom is
`[LogoViewport] no ViewModel bound` and every control being inert. Re-run
`bindViewModelToArtboard`.

### Luau: `ipairs` over an `any` value yields `unknown`

Every loop over decoded JSON needs a re-bind, or `--!strict` rejects field access:

```lua
for _, rawPrim in ipairs(mesh.primitives) do
    local prim: any = rawPrim   -- else: "Type 'unknown' does not have key 'mode'"
```

### Luau: optionals narrowed across a loop body

After the 2026-08 update the solver reports a narrowed optional as
`({number} & ~nil) | {number}` and refuses to index it. Do not narrow an optional
and use it inside a loop; keep concrete tables plus a boolean flag:

```lua
local hasSkin = attrs.JOINTS_0 ~= nil and attrs.WEIGHTS_0 ~= nil
local joints: { number } = {}
```

Likewise, building a `ColorAttachment` in a local and assigning it in an if/else
produces a union that will not match — optional table fields are checked
invariantly. Build such descriptors **inline at the call site** in each branch.

### glTF `baseColorFactor` is linear; only textures are sRGB

Applying `srgbToLinear` to both double-converts and darkens everything.

### Blender exports without embedded textures by default

`0 textures` in the load log means they were not packed. Export with
**File → Export → glTF Binary (.glb)** and Images set to **Pack**. External-URI
images are skipped and logged.

---

## Breaking changes in the 2026-08-27 Rive update

### `drawCanvas` was removed from the Node protocol — then put back

2026-08-27, console said:

```
drawCanvas is no longer called; move its body into draw
```

2026-09-04, after the next update, console said the opposite:

```
GPUCanvas:beginRenderPass() called outside drawing phase
```

`drawCanvas` is back in the protocol, documented as *"Called during the
drawCanvases pass (before draw). All canvas:beginFrame / canvas:beginRenderPass
calls must happen here."*

Then on 2026-09-04, after another update, it flipped **back** to the `draw`
phase — three changes in eight days.

**Do not chase this.** `LogoViewport` implements **both**: `drawCanvas` sets a
`hasCanvasPhase` flag and renders; `draw` renders only if that flag was never
set, then composites either way. Whichever regime the runtime is in, exactly one
render pass happens per frame and no edit is needed when it flips again.

The cost is one informational console line when the runtime ignores whichever
callback it no longer uses. That is much cheaper than a hard
`beginRenderPass() called outside drawing phase` error, which stops rendering
entirely.

### The Luau analyzer got stricter

See the optional-narrowing note above.

---

## Rendering notes

### Frame order

```
init        create canvas, pipeline, bind groups ONCE
update      fires on the first real frame and on every bound-value change
advance     integrate spin + animation clock; return true to keep frames coming
draw        render pass work FIRST, then renderer:drawImage composites
resize      guaranteed with the granted size; recreate size-dependent textures
```

**ViewModel values are not populated during `init`.** `activeModel` starts as a
`"\0"` sentinel and the real load happens in `update`, which `init` schedules
with `context:markNeedsUpdate()`.

**Do not clamp a selection index against data loaded later.** `animationIndex` was
clamped against `#model.animations` during sync, but sync runs *before*
`loadModelIfChanged` on the first frame, so it pinned to 0 and never recovered.
Index the list directly and let an out-of-range value yield nil.

### Vertex layout — 64 bytes

```
 0  float32x3  position
12  float32x3  normal
24  float32x2  uv
32  float32x4  joint indices
48  float32x4  joint weights
```

Joints are `float32x4`, not a packed integer format: Rive's `VertexFormat` list
has no `uint16x4`, and `uint8x4` would silently cap a rig at 256 joints.

### Per-primitive UBO — 256 bytes

```
  0  mat4  mvp
 64  mat4  model
128  mat4  normalMat     inverse-transpose of model
192  vec4  baseColor     rgb linear factor
208  vec4  params        (metallic, roughness, useTextures, unused)
224  vec4  light         (xyz key direction, w ambient)
240  vec4  camera        (xyz eye, w lightIntensity)
```

One UBO **per draw** — a single shared one cannot hold N transforms within one
render pass. 256 bytes is the house stride so one layout serves everything.

### Bind group 0

```
@binding(0)  uniform  the 256-byte block
@binding(1)  texture  albedo   (1×1 white fallback)
@binding(2)  texture  ORM      (white fallback)
@binding(3)  sampler
@binding(4)  uniform  joint palette — array<mat4x4<f32>, 128>
```

White is the neutral element for both albedo multiplication and the ORM channels,
so a material with no maps needs no branching.

The joint palette is a **fixed 128-entry array** because WGSL needs a
compile-time length and every bind group must supply a buffer of exactly that
size. Rigid draws bind a palette of **identities** rather than needing a second
shader and pipeline; the shader branches on whether the weights sum to zero.

### Animation

- Draw items are per *(node, primitive)*. Meshes upload once; nodes instancing
  the same mesh share vertex/index buffers and differ only in transform.
- **Rotations slerp, never lerp.** Componentwise quaternion interpolation changes
  rotation speed mid-arc and can take the long way round.
- `composeWorldMatrices` returns **model-space** matrices with the root transform
  excluded. Joint matrices are built from these, and folding the root in there
  would apply it twice once the mesh's own model matrix carried it too.
- Joint matrix = `jointNodeWorld * inverseBindMatrix`. The mesh node's own
  transform is absent by design — glTF specifies a skinned mesh ignores it.
- **Weights are renormalised in the shader.** Exporters quantise them and they
  drift off 1.0.
- Pose and matrix tables are allocated once per model load and mutated in place.

### Other decisions

- **MSAA 4×** where `features().maxSamples` allows.
- **`cullMode = "none"`** — mirrored transforms or open shells would show holes.
- **Transparent clear**, so the model composites over whatever is behind it.
- **Auto-fit**: every model is centred and scaled to radius 1, so any `.glb`
  frames correctly regardless of authored units.
- Textures decode async: `decodeImage` → `andThen` uploads, rebuilds bind groups,
  then `markNeedsUpdate()` — without that the pixels never appear.

---

## Two bugs worth never repeating

### Buffer writes inside a render pass are silently dropped

The joint-palette upload was placed after `beginRenderPass`. A buffer write
issued between `beginRenderPass` and `finish` is invalid; the driver drops it, or
the whole pass, **without raising an error**. Symptom: model parses perfectly, no
console errors, nothing draws.

All buffer uploads must happen **before the pass opens**.

Note the diagnostic value: an invalidated pass produces *no output at all*,
whereas bad joint data produces visible garbage. "Nothing" and "mangled" point at
different bugs.

### Skinned bounds must be measured, not assumed

Auto-fit computed bounds for skinned meshes from raw `POSITION` values, assuming
bind pose renders there. That holds only when the joint chain is near identity —
true for a rig authored and exported directly from Blender, false for anything
imported.

A Sketchfab crow had a wrapper chain (`Sketchfab_model` at 0.494 × `Crow.fbx` at
0.01), so the inverse-bind matrices carried a ~0.004 residual:

| | assumed radius | actual radius | ratio |
| --- | --- | --- | --- |
| hand-made rig | 3.4519 | 3.4519 | 1.000 |
| Sketchfab crow | 348.87 | **1.31** | **0.00375** |

It rendered the whole time, at about 0.004 units across — sub-pixel.

Bounds for a skinned mesh are now measured by **skinning the vertices at bind
pose exactly as the shader will**, then taking the bounds of the result. Costs one
vertex pass at load.

**The general lesson:** when a feature works on your own test asset and fails on
every downloaded one, suspect an assumption that holds only for clean data —
here, an identity transform chain.

---

## Known limits / next steps

- **No zoom.** Rive exposes no scroll/wheel event. `Camera3D.dolly` is written
  and unwired.
- **`.glb` only.** A `.gltf` needs its sibling `.bin` from a filesystem.
- **Rigs over 128 joints** are clamped, with a warning naming the skin.
- **Morph targets** are not implemented.
- Normals are transformed by the skin matrix directly — correct for rigid joints,
  slightly off under non-uniform joint scale.
- Non-triangle primitive modes and sparse accessors are skipped.
- Lighting is a hardcoded key/fill/rim plus hemisphere ambient. An environment map
  would need a second bind group (group 0 has 5 of 8 slots used).
