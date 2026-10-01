# PROJECT HANDOVER: DeepSeek Harness Session Control Plugin (`dsh-session-control`)

## 1. Goal & Product Vision
The objective is to create a complete, developer-grade session control plugin for **DeepSeek Harness (DSH)** named `dsh-session-control` (located in `D:\Deepseek\Pluggin\session-control`).

The user declined automated cleaners/token-reduction indicators and specifically requested **9 granular control features**:
1. **Edit Output**: Edit any previous assistant output (must support proper rendering of LaTeX/math formulas).
2. **Delete Output**: Delete the assistant output for a turn while keeping the user prompt.
3. **Delete Input / Entire Turn**: Delete any user message and its entire turn.
4. **Delete Tool Calls**: Granularly remove intermediate tool calls and tool results to declutter and save token context.
5. **Delete Thinking / Reasoning**: Strip `<think>` reasoning traces from thinking models (e.g., DeepSeek-R1) while preserving the final answer.
6. **Edit & Resend (Rerun Anew)**: Edit an earlier user prompt; discard all downstream turns/tools/outputs after that point, and rerun/continue from that edited prompt in the same session.
7. **Undo Turn**: One-click rollback button (e.g. on composer dock) that removes the last turn and restores the user's prompt text into the composer draft.
8. **Exclude from Context (Mute / Ghost Mode)**: Toggle mute on any message/turn so it is excluded from future LLM context payloads without being permanently deleted. Muted messages must remain editable, deletable, and unmutable.
9. **Safety Snapshot & Local Undo History**: Automatically create a timestamped backup before any destructive mutation, with a drawer/dialog to review and restore any previous snapshot.

---

## 2. Current Status & Critical Symptoms
* Current location: `D:\Deepseek\Pluggin\session-control`
* Package files: `package.json`, `cordis.patch.yml`, `index.js` (host backend), `client.js` (client UI frontend).
* **Current user report**:
  - **Nothing works.** None of the buttons work properly.
  - When clicking action buttons (e.g., edit, edit & resend, delete), **the DeepSeek Harness app crashes/restarts**.
  - After restarting, the conversation reverts back to the exact initial state (square one) with no changes applied.
  - Session state may get wiped or fail to reload.

---

## 3. High-Value Technical Findings (Read Carefully Before Modifying)

### A. How DSH Stores Sessions on Disk
- Stored under `%APPDATA%\dsh-desktop\harness\sessions\--<project-key>--\<session-id>\`.
- Session file format: `session.v4.jsonl.zstd` (or uncompressed `.jsonl`).
- **Multi-Frame Zstandard**: The `.zstd` file contains multiple independent Zstd frames concatenated together. Standard single-buffer decompression fails or reads only the header frame. Individual frame offsets must be scanned via magic number `0xFD2FB528` (`4247762216`) and decompressed frame-by-frame.
- First line is a header: `{"type":"session","version":4}` (has no `seq`).
- Event types: `turn/start`, `user/message`, `step/start`, `system/message`, `developer/message`, `assistant/attempt`, `tool/call`, `tool/result`, `assistant/message`, `step/end`, `turn/end`.

### B. In-Memory Session Handles & Cache Invalidation Trap
- **Crucial Crash/Reset Trap**: `ctx.sessions.detachEntered()` or improper mutation of `ctx.sessionController.handles` triggers `session/disposed`. This kills the running session/agent, crashes or forces a reload of the web GUI, and reverts to disk state or leaves the session corrupted.
- Inspect how the host harness actually handles session reloading or if an in-place API/fork is required.

### C. Client Environment & Slots
- Client module loader uses `window.__ModuleLoader__.load({ id, factory(require) { ... } })`.
- `require('react-dom')` / `ReactDOM.createPortal` may be unavailable or break in the client sandbox.
- Standard session-scoped slots (`conversation.composer.dock`, `conversation.chat.turnTail`, `conversation.chat.assistant-actions`) receive `sessionId`, `useChat`, `useSession`, and `inputActions` as standard props.
- `shell.overlay` is root-scoped (not session-scoped).

---

## 4. Instructions for the Incoming AI
1. **Fresh Investigation**: Do not blindly trust existing assumptions in `index.js` or `client.js`. Investigate the actual root causes from scratch.
2. **Find why it crashes/restarts**: Check why invoking backend mutations or client actions causes the harness to restart and revert.
3. **Verify every feature**: Make sure editing, deleting, edit-and-resending, muting/unmuting, undoing, and restoring snapshots work seamlessly without crashing the harness.
4. **Fix and test cleanly**: Ensure all 9 features are delivered in full working condition.
