# Countdown Timer — build spec

Build this into the currently open Rive project / artboard using the `rive` MCP server.

## Decisions (confirmed by user)

| Choice | Decision |
| --- | --- |
| Controls | **ViewModel only** — no buttons drawn on the artboard |
| Display | **MM:SS** text run |
| Setting duration | **Typed in as a string** (e.g. `5:00`) |
| Logic | **Rive Scripting** (Luau, `advance` callback) |

## ViewModel

Name: `CountdownTimer`

| Property | Type | Direction | Purpose |
| --- | --- | --- | --- |
| `durationInput` | string | in | User-typed duration. Accept `SS`, `MM:SS`, `HH:MM:SS`. Whitespace tolerant. |
| `display` | string | out | Formatted remaining time, bound to the text run. |
| `remainingSeconds` | number | out | Raw seconds left, for host logic. |
| `isRunning` | boolean | in/out | Start/pause state. Reflects actual state. |
| `start` | trigger | in | Begin / resume counting. |
| `pause` | trigger | in | Halt without resetting. |
| `reset` | trigger | in | Re-parse `durationInput`, stop, restore full duration. |
| `finished` | trigger | out | Fires once when the timer reaches zero. |

## Behaviour

- **Parse:** `durationInput` → total seconds. `"90"` = 90s, `"5:00"` = 300s, `"1:02:03"` = 3723s.
  On an unparseable string, keep the previous valid duration and do not crash.
- **start:** if `remainingSeconds <= 0`, re-parse `durationInput` first, then set `isRunning = true`.
  Resumes from the current value if mid-countdown.
- **pause:** `isRunning = false`. `remainingSeconds` preserved.
- **reset:** re-parse `durationInput`, set `isRunning = false`, refresh `display`.
- **advance(dt):** while running, `remainingSeconds -= dt`, clamped at 0.
  On hitting 0 → `isRunning = false`, fire `finished` exactly once.
- **Editing `durationInput` while stopped** should refresh `display` immediately.
  While running, it takes effect on the next `reset`.

## Display formatting

- Use **ceiling** on remaining seconds, so a fresh 5:00 timer reads `05:00`, not `04:59`,
  and `00:00` appears only at true zero.
- Under one hour → `MM:SS`, zero-padded (`05:00`, `00:07`).
- One hour or more → `H:MM:SS`.

## Artboard wiring

- One text run bound to `CountdownTimer.display`.
- Attach the script so its `advance` runs every frame.

## Open question to confirm at build time

`durationInput` is a ViewModel string the host app sets. If the intent was instead an
**editable text field inside the artboard** that the user types into directly, say so —
that changes the wiring (editable text run feeding the same parse step), not the logic.
