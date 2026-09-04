# Porting the live chat to another Rive project

Nothing here carries over automatically — object ids are per-file, so the chat has to be
rebuilt in the target file. The script is the only literal copy-paste.

**Fastest route:** open the other project in the Rive desktop app and ask Claude to
"build the live chat from PORTING-CHAT.md". The whole sequence below is MCP-driven and
takes a couple of minutes. Do it by hand only if you want to understand each piece.

Source of truth for the script: [`ChatList.lua`](ChatList.lua) in this folder.

---

## What you are rebuilding

| Piece | Role |
| --- | --- |
| `ChatMessage` ViewModel | One row: who said it, what, and in what colour |
| `ChatRoom` ViewModel | The feed: list of messages, the draft text, the send signal |
| `ChatRow` component artboard | The visual template for a single row |
| `MessageList` layout | The scroll window the rows stack inside |
| `ChatList` script | Seeds the feed, streams new messages, appends your comment |

---

## 1. ViewModels

Create two:

**`ChatMessage`**
- `username` — string
- `message` — string
- `color` — color

**`ChatRoom`**
- `messages` — list
- `draft` — string
- `send` — trigger

Create one instance of each (`Default` and `Room`). Names are free, but the **property
names must match exactly** — the script looks them up by string (`getList("messages")`,
`getString("draft")`, `getTrigger("send")`), and `Data.ChatMessage.new()` resolves the
ViewModel by name.

## 2. The row component

Create an artboard `ChatRow`, **650 x 44**, with **isComponent = true**.

Build this layout inside it:

```
Row              flex row, align top-left, width fill, height hug, gap 8, padding 4/4/2/2
├── Name         width hug,  height hug   → text, 28pt, any colour (it gets overridden)
└── Message      width fill, height hug   → text, 28pt, white
```

> **Each text must sit inside its own child layout.** A text placed directly in the flex
> row gets no layout style, so it is never positioned and every row renders its name and
> message stacked on top of each other. This is the single easiest thing to get wrong.

Then:
- Set the artboard's fill `SolidColor` to `#00000000`, or every row paints an opaque block.
- Make the username bold: on its text style, the `TextStyleAxis` whose `tag` is
  `2003265652` (`wght`) — set `axisValue` to `700`.

## 3. Bind the row

Bind the `ChatMessage` instance to the `ChatRow` artboard, then bind three things:

| Target | Property | Source |
| --- | --- | --- |
| Name `TextValueRun` | `text_value` (key 268) | `username` |
| Message `TextValueRun` | `text_value` (key 268) | `message` |
| Name fill's `SolidColor` | `color` (key 37) | `color` |

Bind the **`TextValueRun`**, never the parent `Text` — binding the `Text` silently does
nothing. Binding the run's `SolidColor` is what gives each user their own colour.

## 4. The list on the main artboard

> **Watch the active artboard.** `layout_editor` writes to the *active* artboard, and
> `focusArtboard` does **not** change it — it reports success while `isActive` stays put, so
> layouts silently land in whichever artboard you built last. Switch by calling
> `select_objects` on something in the target artboard, and confirm with `list_artboards`
> that `isActive` moved. If layouts end up in the wrong place, `reparent_objects` fixes it
> without rebuilding.

Bind the `ChatRoom` instance to the artboard. Then create the container:

```
MessageList   absolute, flex column, align bottom-left, fixed size (e.g. 655 x 600), clip
```

- Set its layout style `overflowvalue` (key 605) to `1` (hidden), or rows spill outside
  the panel instead of clipping at its edge.
- `bottom-left` alignment is what makes the feed sit at the bottom and grow upward.

Now add the component list as a child of `MessageList`, with its list source set to the
`messages` property. Do **not** add rows manually — the list generates them at runtime.

## 5. The text input

Bind the input's `TextValueRun` `text_value` to `ChatRoom.draft`, then set that bind to
**two-way** so typing writes back into the ViewModel. Clear any converter left on it.

## 6. The send button

Add a click listener whose action is a `viewModelChange` on the `send` trigger.

Target a **Shape** — pointer input is not available on an artboard or nested artboard. If
your button is a nested artboard, target a shape inside or next to it, or lay a
transparent rectangle over it and use that.

## 7. The script

Create a Luau script named `ChatList`, seeded with the contents of `ChatList.lua`.

Then, in order:

1. Check `scriptProtocol`. Create the ViewModels **before** the script and it usually
   compiles straight to `"node"`, because `Data.ChatMessage` resolves.
2. If it says `"utility"`, **open the script once in Rive's script editor**. Rive loads
   scripts lazily; until then it will never run and cannot be edited over MCP.
   `recompile_all_scripts` does not fix this.
3. Check diagnostics return `[]`.
4. **Drag the script onto the artboard.** It cannot be placed over MCP. Nothing streams
   until you do this.

---

## Tuning

Top of `ChatList.lua`:

```lua
local MAX_ROWS = 15           -- rows before the oldest drops off the top
local NEW_MESSAGE_EVERY = 1.6 -- seconds between auto-generated messages
local INITIAL_ROWS = 8        -- rows present on load
local SEED = { ... }          -- the demo message pool
```

For a real feed rather than a demo, delete the `advance` function and the `SEED` table and
call `addMessage` from your host app instead — via a trigger on `ChatRoom`, or by pushing
`ChatMessage` instances into `messages` directly from the runtime.

## If something looks wrong

| Symptom | Cause |
| --- | --- |
| Name and message overlap | Texts not wrapped in their own child layouts (step 2) |
| Rows are solid dark blocks | `ChatRow` artboard fill not set to `#00000000` |
| Every name is the same colour | Bound the `Text`, not the run's `SolidColor` |
| Nothing appears at all | Script still `utility`, or never dragged onto the artboard |
| Rows spill past the panel | `overflowvalue` still `visible` |
| Feed grows downward | `MessageList` alignment not `bottom-left` |
| Typing does nothing | Input bind not two-way, or stale converter attached |
