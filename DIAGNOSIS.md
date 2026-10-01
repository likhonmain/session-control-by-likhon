# dsh-session-control — Problems & Root Cause Solutions

## 1. Root Cause of Image 2 ("turn/start does not open the expected turn" Corruption)
In DeepSeek Harness, the session validator (`worker.cjs`) enforces strict turn and step invariants:
```javascript
case "turn/start":
  if (this.turn !== null || data["turn"] !== this.nextTurn) {
    throw new SessionFormatError("turn/start does not open the expected turn");
  }
```
Whenever a turn was deleted or truncated:
- Previously, the code removed the events for that turn, but left downstream turns with their original `data.turn` numbers (e.g. Turn 1, then Turn 3).
- DSH requires turns to be strictly **1, 2, 3, 4, ... contiguous** without any missing numbers.
- In addition, an unclosed step (missing `step/end`) or unclosed turn (missing `turn/end`) leaves `this.turn !== null`, causing DSH to reject the log and mark the session as permanently corrupt.
- When the user attempted to delete or open the session in DSH Desktop, DSH's internal inspection rejected the corrupted turn numbers and displayed the modal error in Image 2.

### Fix Applied:
1. **Canonical Event Normalizer (`normalizeAndValidateEvents`)**:
   - Re-indexes all kept turns contiguously to `1, 2, 3, ...` and updates `data.turn` across all events (`turn/start`, `turn/end`, `step/start`, `step/end`, etc.).
   - Guarantees every turn has a matching `turn/end` and every step has a matching `step/end`.
   - Re-indexes steps inside every turn contiguously to `1, 2, ...`.
   - Filters out advertised tool calls from `assistant/message` if tools are deleted so DSH's tool lifecycle assertion passes.
   - Re-indexes all sequence numbers contiguous from `0` to `N - 1`.
2. **Session `session-d4481c73-843e-4691-a727-63e1424adb24` Fully Restored**:
   - Normalized all 5 turns and their steps into a valid multi-frame Zstandard session log.
   - Verified that DSH's validator passes with 100% compliance.

---

## 2. Duplicate "Edit" Buttons (Image 1)
- **Cause**: The plugin was injecting `✏️ Edit Output` in the turn tail (`conversation.chat.turnTail`) AND also injecting a separate `[✏️ Edit]` button into `conversation.chat.assistant-actions`. The bottom button lacked turn context and was editing the wrong message.
- **Fix**: Removed `conversation.chat.assistant-actions` injection completely. There is now only **one unified, full-featured `✏️ Edit Output` button** in the turn toolbar with live KaTeX LaTeX formula preview.

---

## 3. Why Other Actions Were Failing & Fixes
- **Edit & Resend**:
  - *Previous Issue*: Sliced events right at `user/message`, leaving an open turn without a `turn/end`.
  - *Fix*: If user chooses "Truncate & Keep", cleanly closes the turn with `turn/end`. If "Rerun", rolls back cleanly and injects the edited prompt text directly into the composer draft.
- **Delete Output**:
  - *Previous Issue*: Left orphaned step events.
  - *Fix*: Retains only `turn/start` -> `user/message` -> `turn/end`, cleanly clearing all assistant messages, reasoning traces, and tool execution steps.
- **Delete Turn**:
  - *Previous Issue*: Left gap in turn numbers.
  - *Fix*: Normalized all subsequent turns to contiguous numbers (`1, 2, 3, ...`) and shifted mute metadata.
- **Delete Tools**:
  - *Previous Issue*: Left advertised tool calls in `assistant/message`, triggering DSH's `assertNoUnresolvedTools` exception.
  - *Fix*: Filters out `type: 'tool-call'` blocks from `assistant/message` in that turn.
- **Delete Thinking**:
  - *Fix*: Removes `assistant/attempt` and strips `<think>...</think>` tags while preserving final response.
- **Mute / Ghost Mode**:
  - *Fix*: Toggles exclusion in `session-mute-meta.json`, emits `api-session/activity`, and visually updates the button to `👻 Muted`.
