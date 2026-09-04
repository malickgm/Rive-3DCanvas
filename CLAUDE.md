# Rive MCP project

Drives the **Rive editor** (desktop, `RiveEarlyAccess`) through its MCP server.

## Transport: native tools first, CLI as fallback

`mcp__rive__*` tools **do** load natively (confirmed 2026-08-06, after registering the server
at user scope and in `.mcp.json`). Load them with ToolSearch and use them directly.

They took several restarts to appear. If they are ever absent again, check once with
ToolSearch and fall back to `rive-cli.js` below rather than looping on restarts.

The server itself is healthy. It listens on `http://127.0.0.1:9791/mcp`, is owned by the
`RiveEarlyAccess` process, and exposes **36 tools**. A GET returns 405; that is expected
(the transport is POST-only) and is a quick way to confirm Rive is running.

## Driving it: `rive-cli.js`

A minimal MCP-over-HTTP client. It handles the `initialize` handshake and SSE parsing.

```bash
node rive-cli.js tools
node rive-cli.js schema <toolName> [...]
node rive-cli.js call <toolName> <argsFile.json>
```

**Always pass tool arguments via a JSON file, never inline.** Shell escaping of nested
JSON and Windows paths broke repeatedly; a file avoids it entirely. Write the args with
the Write tool, then call.

Read a tool's schema before first use. Descriptions are detailed and several tools take a
`{command, data: {<command>: {...}}}` shape where `data` is keyed by the command name.

## Build order that works

1. `viewmodel_editor` → `createViewModels` (returns property ids — keep them)
2. `viewmodel_editor` → `createViewModelInstances` (needs `viewModelPropertyId`, values are strings)
3. `layout_editor` → `createLayout` for visuals
4. `viewmodel_editor` → `bindViewModelToArtboard`
5. `query_property_keys` on the target object → get the integer `propertyKey`
6. `viewmodel_editor` → `databind` (bind the **TextValueRun**, not the Text object)
7. `manage_scripts` → `create` with `content` seeded inline
8. `script_diagnostics` → must return `[]` before moving on
9. Verify with `listDataBinds` / `get_artboard_hierarchy`

## Gotchas that cost real time

- **Text children in `layout_editor`:** a `text` child must carry only `componentType`,
  `value`, `textStyle`. Adding `name` or `layoutStyle` makes it match the layout branch too
  and the call fails with `Value matches 2 schemas ... oneOf`. Text cannot be added via
  `appendLayout` — that command only accepts `componentType: "layout"`.
- **Node scripts cannot be placed from the MCP.** `component_editor` only accepts component
  *artboards* and returns `Component not found` for a script asset. The user must drag the
  script onto the artboard by hand. Nothing ticks until they do.
- **A newly created script is not loaded by the editor.** `manage_scripts create` succeeds and
  `grep` confirms the source is intact, but `assets_tool` reports `scriptProtocol: "utility"`,
  `text_editor` and `script_diagnostics <path>` both say the file "does not exist or has not
  been loaded", and `recompile_all_scripts` does not fix it. The user must open the script once
  in Rive's script editor; only then does it compile and classify as `node`. Verify with
  `assets_tool listAssets typeFilter=script` — do **not** trust the `create` success alone.
- **Creating a script over a deleted name yields an empty file.** The old source lingers as an
  orphan (visible in `grep` under a numeric id) and the new script gets no content. Delete,
  confirm with `grep` that the source is gone, then create under a fresh name.
- **Component lists:** build the row as its own artboard with `isComponent: true`, bind it to
  the item ViewModel, then `component_editor addComponentList` with the list property id.
  Row artboards default to an opaque fill — set the SolidColor to `#00000000`.
- **Bold text:** `TextStyleAxis` tag `2003265652` is `wght`; set `axisValue` (key 288) to 700.
- **Bind the text run.** Binding the `Text` object instead of its `TextValueRun` silently
  does not do what you want.
- `delete_objects` is permanent — confirm before removing anything not created in-session.

## Scripting API essentials

Look up types with `get_scripting_reference`. Useful topics: `viewmodel_definitions`
(reflects the file's actual ViewModels), `example_node`, `rive/interfaces`, `rive/dataValue`.

- Node protocol: `init(self, context)`, `advance(self, seconds)`, `update(self)`, `draw(self, renderer)`;
  module returns a factory `function(): Node<T>`.
- `context:viewModel()` → `getString` / `getNumber` / `getBoolean` / `getTrigger`.
- Properties expose `.value` (read and write) and `addListener`. Triggers have `:fire()` and `addListener`.
- **Store the ViewModel on `self`** (`self.vm = context:viewModel()`). A local goes out of scope
  and listeners are garbage collected.
- `advance` returns `true` to keep receiving frames.

## Current state

`CountdownTimer` ViewModel + `TimerInstance` bound to the artboard, a centered 72pt text run
bound to `display`, and the `CountdownTimer` node script. Confirmed working.

`CountdownTimer.lua` in this folder is a **copy** — the live source lives in Rive and the two
will drift. Edit in Rive, or re-upload deliberately.
