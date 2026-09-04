# Scripting: `context:shader()` and `context:viewModel()` return nil in an exported `.riv` at runtime (web)

**Summary.** A layout script that works correctly in the Rive editor fails in an
exported `.riv` loaded with `@rive-app/webgl2`. `context:gpuCanvas()` works, but
`context:shader(name)` returns nil for a shader asset that demonstrably exists —
by name — in the exported asset table, and `context:viewModel()` returns nil for
a ViewModel that is bound to the artboard.

Everything renders correctly inside the editor.

---

## Environment

| | |
| --- | --- |
| Runtime | `@rive-app/webgl2` **2.42.0**, `@rive-app/react-webgl2` **4.34.0** |
| Editor | Rive desktop (Early Access, and stable `com.flutter.riveeditor` 1.8.5674.5661) |
| Host | Next.js 16.3.3, React 19.2.8 |
| GPU | ANGLE / NVIDIA RTX 5070 Ti, D3D11 (WebGL2) |
| OS | Windows 10 Pro 19045 |

---

## What the file does

A `layout` protocol Luau script renders a glTF model on the GPU canvas:

```lua
function init(self, context)
    self.canvas = context:gpuCanvas()            -- OK
    local shader = context:shader("PBR3D")       -- nil at runtime, fine in editor
    local vm     = context:viewModel()           -- nil at runtime, fine in editor
end
```

`PBR3D` is a WGSL shader asset added in the editor. `LogoScene` is a ViewModel
bound to the artboard with an instance.

---

## Expected

`context:shader("PBR3D")` returns a `Shader`, and `context:viewModel()` returns
the bound `LogoScene` instance — matching editor behaviour.

## Actual

Both return `nil`, permanently, in the exported file.

```
[LogoViewport] attempt 1:  shader 'PBR3D' was not found in this file
[LogoViewport] attempt 30: shader 'PBR3D' was not found in this file
[LogoViewport] no ViewModel yet — waiting for the host to bind LogoScene
```

In the editor, the same script logs:

```
[LogoViewport] renderer ready after 1 attempt(s)
[LogoViewport] loaded 'Bot-New.glb': 73 nodes, 2 primitives, 2 materials,
               3 textures, 1 skins, 6 animations
```

---

## What has already been ruled out

This is not a "the asset didn't get exported" or "you looked it up too early"
problem. Each of the following was verified directly.

**1. The script runs and is ticked.**
A retry counter in `advance` printed `attempt 1` and `attempt 30`. The lookup is
being retried across many frames and never resolves — it is not a one-shot
init-ordering mistake on our side.

**2. The shader is present in the exported binary, as a named asset.**
Searching the `.riv` for `PBR3D` yields two hits: one string constant inside the
Luau bytecode, and one **length-prefixed asset name in the asset table**,
immediately followed by the `BTSR` shader blob.

**3. The shader cross-compiles correctly at export.**
Recent editor builds translate the WGSL to GLSL ES 300 on export (entry point
renamed `vertexMain` → `main`). Both stages are present and well-formed in the
file, e.g.:

```glsl
#version 300 es
precision highp float;
struct JointPalette { mat4x4 m[128]; };
layout(std140) uniform JointPalette_block_1Vertex { JointPalette _group_0_binding_4_vs; };
```

**4. It is not a GPU capability limit.**

| | needed | available |
| --- | --- | --- |
| uniform block size | 8192 B | 65536 B |
| vertex uniform blocks | 2 | 12 |
| vertex attributes | 5 | 16 |

**5. It is not `autoBind`.**
The shader lookup fails identically with `autoBind: true` and `autoBind: false`,
and shader resolution is unrelated to data binding in any case.

**6. `assetLoader` is never invoked for these assets.**
A registered `assetLoader` callback logged **zero** assets for this file —
neither the shader (`.rstb`) nor an embedded `.glb` blob asset was surfaced
through it, only (in other files) images/fonts/audio. This may be the same root
cause: script-visible assets appear not to be registered by the runtime loader.

---

## Minimal reproduction

1. New Rive file. Add a WGSL shader asset named `Test`.
2. Add a ViewModel `Data` with a number property, bind an instance to the artboard.
3. Add a layout script and drop it on the artboard:

```lua
function init(self, context)
    print("gpuCanvas:", context:gpuCanvas() ~= nil)
    print("shader:",    context:shader("Test") ~= nil)
    print("viewModel:", context:viewModel() ~= nil)
    return true
end

return function(): Layout<{}>
    return { init = init, resize = function() end }
end
```

4. Editor console → all three `true`.
5. Export `.riv`, load with `@rive-app/webgl2` 2.42.0 in a browser.
6. Browser console → `gpuCanvas: true`, `shader: false`, `viewModel: false`.

---

## Impact

GPU Canvas landed in the web runtime in 2.42.0 — a real step forward, and
`context:gpuCanvas()` now works. But a GPU-canvas scene is not useful without a
shader, so scripted 3D still cannot ship to web. The ViewModel gap separately
means a script cannot read any data-bound value at runtime, so even a
hardcoded-shader scene would be uncontrollable from the host app.

---

## Question

Are script-accessible assets (shaders, blobs) and the script data context
expected to work in exported files yet, or is that still landing? If there is a
required setup step on the runtime side — an equivalent of the
`setRenderContext()` mentioned in a nearby error string — it does not appear in
the `@rive-app/webgl2` typings or docs.
