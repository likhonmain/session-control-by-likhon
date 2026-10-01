# DSH Session Control & History Granularity Plugin (`dsh-session-control`)

A local conversation-control plugin for **DeepSeek Harness (DSH)**.

## Startup repair — October 1, 2026

Desktop had replaced this local plugin with the unrelated public npm package
`dsh-session-control@1.1.0`. That package manages whole sessions and host shutdown;
it does not provide this plugin's per-turn controls. The host log also recorded
`webserver: duplicate exact route "/dsh-sc/delete"` during its activation.

The local build is now `1.0.2-local.1`. Install it from this directory using
`npm run install:desktop`, which uses Desktop's generation installer and preserves
the previous package and profile settings under `backups/`. Do not install or
update it using the bare public npm name: that selects the other package.

`npm run check:startup` starts a temporary host on port 43299, checks the local
status endpoint and client module graph, then stops that test host. It does not
open or edit a conversation. The endpoint `/api/session-control/status` identifies
the loaded build.

**Verification scope:** backend startup and client module inclusion passed.
History editing, deletion, mute, resend, and recovery have not been repaired or
verified in this step. Use a disposable chat for further checks. The older fix
claims below and in `DIAGNOSIS.md` describe previous attempts, not verified results.

This plugin empowers users and developers with complete control over conversation history, prompt context, and token consumption directly within the DeepSeek Harness Web GUI.

---

## 🚀 9 Granular Control Features

| # | Feature | Location | What It Does |
|---|---|---|---|
| **1** | **✏️ Edit Output (with KaTeX Math Preview)** | Message hover & Turn toolbar | Edit any previous assistant output with real-time, side-by-side **KaTeX LaTeX math formula rendering** (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`). |
| **2** | **🗑️ Delete Output** | Turn toolbar (`🗑️ Output`) | Deletes only the assistant response for a specific turn, keeping the user prompt intact. |
| **3** | **🗑️ Delete Input / Entire Turn** | Turn toolbar (`🗑️ Turn`) | Removes the entire turn (user prompt, assistant response, tool calls, and thinking traces). |
| **4** | **✂️ Delete Tool Calls** | Turn toolbar (`✂️ Tools`) | Strips verbose intermediate tool calls and tool output results (file dumps, command logs) to declutter the transcript and save context window tokens. |
| **5** | **🧠 Delete Thinking / Reasoning** | Turn toolbar (`🧠 Thinking`) | Strips `<think>` reasoning traces and reasoning attempt frames from thinking models (e.g., DeepSeek-R1) while preserving the final answer. |
| **6** | **🔄 Edit & Resend (Rerun Anew)** | Turn toolbar (`🔄 Edit & Resend`) | Edit an earlier user prompt; automatically truncates all downstream turns, tool calls, and outputs, allowing the session to rerun anew from that prompt. |
| **7** | **↩️ Undo Turn (Rollback)** | Composer dock (`↩ Undo Turn`) | One-click rollback button that deletes the last turn and restores the user's prompt text directly into the composer draft. |
| **8** | **👻 Exclude from Context (Mute / Ghost Mode)** | Turn toolbar (`👻 Mute` / `👻 Muted`) | Excludes selected turns from being sent to the LLM in subsequent model calls without deleting them from the chat interface. Muted turns remain visible, editable, and unmutable. |
| **9** | **🕒 Safety Snapshots & Local History** | Composer dock (`🕒 Snapshots`) | Automatically creates a timestamped backup before any destructive mutation. Review, restore, or delete any snapshot in one click via a dedicated history drawer. |

---

## 🛠️ Technical Architecture

### 1. Multi-Frame Zstandard Serialization (`.v4.jsonl.zstd`)
DSH requires a strict multi-frame Zstandard format:
- **Frame 0**: Must be independently decodable and contain **strictly one header line**: `{"type":"session","version":4,...}\n`. DSH asserts `plaintext.indexOf(10) === plaintext.length - 1` on the first frame.
- **Frame 1+**: Contains the JSONL event log compressed with `{ params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }`.
- Concatenation: `Buffer.concat([headerFrame, eventsFrame])`.
- This resolves the previous fatal crash caused by single-frame serialization.

### 2. In-Memory State & Cache Synchronization
When a session is resident in DSH memory (`ctx.sessions.get(sessionId)`), disk-only writes cause handle desynchronization:
- **`writer.observedLength` & `writer.state.cursor`**: Synchronized to the new event count to prevent `"stored log shrank below a previously observed prefix"`.
- **`liveSession.log` & `SurfaceManager`**: In-memory event array updated and surface fold state reset.
- **`sessionPersistence.coldLogMemo` & `sessionQuery._observations.cache`**: Cache entries cleared so next read fetches authoritative data.

### 3. Context Exclusion Interceptor (Ghost Mode)
- Hooks into `ctx.llm.prepareCall` and `ctx.llm.stream`.
- Inspects `session-mute-meta.json` companion file for the active session.
- Filters out message objects belonging to muted turns from `options.messages` before adapter dispatch.
- Visual badges in the Web GUI indicate muted status (`👻 Muted`).

### 4. Offline & Local KaTeX Rendering
- Bundles full KaTeX library under `node_modules/katex/dist`.
- Backend serves static assets locally under `/api/session-control/katex/*`.
- Client dynamically injects stylesheets and scripts with CDN fallback if required.
- Markdown parser safely handles block math, inline math, code blocks, lists, blockquotes, and HTML escaping.

---

## 📂 File Layout

```
D:\Deepseek\Pluggin\session-control/
├── package.json          # Bundle specification, client platform & dependency injection
├── cordis.patch.yml      # Profile bundle patch registration
├── index.js              # Host-side backend service, REST API & LLM interceptor
├── client.js             # Client-side UI registering into DSH Web slots
├── README.md             # Complete documentation and usage guide
├── HANDOVER.md           # Architectural notes & crash diagnosis
├── node_modules/         # Local dependencies (katex)
```

---

## 🎯 Verification

1. **Info Endpoint**: `GET /api/session-control/info?sessionId=<id>` returns structured turns, user messages, assistant outputs, tool calls, and mute state.
2. **Snapshots Endpoint**: `GET /api/session-control/snapshots?sessionId=<id>` lists all automatic timestamped backups with file sizes and creation reasons.
3. **Mute Mode**: `POST /api/session-control/toggle-mute` toggles context exclusion state in `session-mute-meta.json` without modifying or deleting session text.
4. **Multi-Frame Zstd Integrity**: Verified using `assertZstdHeaderFrame` and multi-frame decompression against DSH internal assertions.
