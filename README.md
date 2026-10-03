# Session Control by Likhon (`dsh-session-control`)

A developer-grade conversation and context management plugin for **DeepSeek Harness (DSH)**.

Provides granular, non-destructive control over conversation turns, messages, and model context directly within the DeepSeek Harness Web GUI.

---

## 💡 Architecture: Non-Destructive Sidecar Projection (v2)

Earlier approaches that attempted to rewrite DSH's raw session files (`session.v4.jsonl.zstd`) frequently caused fatal corruption because DSH enforces strict invariants:
- Contiguous turn indexing (`turn: 1, 2, 3...`)
- Matching lifecycle boundaries (`turn/start` ↔ `turn/end`, `step/start` ↔ `step/end`)
- Multi-frame Zstandard compression frame boundaries
- In-memory handle synchronization

**How this plugin solves it safely:**
1. **Raw Logs Remain Untouched**: Your underlying `session.v4.jsonl.zstd` event log is never modified or truncated, eliminating any risk of crash, desync, or conversation loss.
2. **Sidecar State Store**: Edits, deletions, and mute statuses are tracked in an isolated JSON sidecar store (`$DSH_HOME/session-control/v2/<sessionId>.json`).
3. **Dynamic Context Projection**:
   - **Host API Layer (`index.js`)**: Hooks into `session.deriveMessages` to project the filtered and edited message history just before dispatching to the LLM.
   - **Compaction Guard (`core.js`)**: Intelligently traces compaction summaries. If a turn was edited or muted, stale compaction summaries are unwrapped so modified/muted content never leaks to the LLM.
   - **Web UI Layer (`client.js`)**: Injects controls into `conversation.chat.turnTail` and updates the live conversation view in-place via external store subscription.

---

## ✨ Features

| Feature | Action | Description |
|---|---|---|
| **✏️ Edit Output** | `Edit output` | Edit any previous assistant output. Updates both the web view and future LLM context payloads. |
| **Word copy** | `Word copy` | Selects and copies the final rendered output using the browser's native rich copy, like mouse selection followed by Ctrl+C. Paste into Microsoft Word with **Keep Source Formatting** to preserve headings, bold text, lists, and rendered equations. |
| **✏️ Edit Input** | `Edit input` | Edit any earlier user prompt. Future model responses treat the prompt as if originally typed that way. |
| **🗑️ Delete Output** | `Delete output` | Clears the assistant response for the turn while keeping the user prompt and tool protocol intact. |
| **🗑️ Delete Input** | `Delete input` | Removes a specific user prompt from model context. |
| **❌ Remove Turn** | `Remove turn` | Excludes the entire turn (user message, assistant response, intermediate tool calls, and reasoning) from subsequent context and UI. |
| **👻 Mute / Ghost Mode** | `Mute / Ghost` / `Unmute` | Toggles whether a turn is sent to the LLM. When muted (`sc-muted`), the turn remains visible in the chat interface for reference, but is completely omitted from LLM API payloads to conserve context tokens. Unmuting instantly restores it. |
| **🛡️ Compaction Shielding** | *Automatic* | Prevents muted or edited content from inadvertently leaking into the LLM through pre-computed conversation compaction summaries. |
| **⚡ Modal Editor** | *Built-in* | Clean dialog overlay with multi-message selector, multi-line editor, `Escape` to cancel, and instant saving. |

---

## 📦 File Layout

```
session-control-by-likhon/
├── cordis.patch.yml       # Profile patch inserting session-control row
├── package.json           # Bundle manifest, client exports & dependencies
├── index.js               # Host service, context adapter & REST routes (/api/session-control/*)
├── core.js                # Shared projection engine, turn indexer & message transformer
├── state-store.js         # Durable sidecar JSON store ($DSH_HOME/session-control/v2)
├── client-entry.js        # React client source for DSH Web slots
├── client.js              # Compiled browser client artifact
├── tests/
│   ├── core.test.mjs      # 14 comprehensive unit tests
│   └── harness.mjs        # Test mock harness
└── tools/
    ├── build-client.mjs   # Inlines core into client artifact
    ├── install-desktop.mjs# Installs directly into DSH Desktop immutable generation
    └── check-startup.mjs  # Verifies host startup and client module graph
```

---

## 🚀 Installation & Usage

### Method 1: Local Installation into DSH Desktop

1. Clone or download the repository:
   ```bash
   git clone https://github.com/likhonmain/session-control-by-likhon.git
   cd session-control-by-likhon
   ```

2. Install the required dependencies (creates the `node_modules` folder needed by the installer):
   ```bash
   npm install
   ```

3. Build the client bundle:
   ```bash
   npm run build
   ```

4. Run the automated test suite:
   ```bash
   npm test
   ```

5. Install into your local DSH Desktop profile:
   ```bash
   npm run install:desktop
   ```
   *This automatically builds an immutable generation, links it into `%APPDATA%\dsh-desktop\harness\profiles\web`, and commits the profile update.*

---

### Method 2: Via GitHub Spec

You can install directly from GitHub using the repository URL:
```
https://github.com/likhonmain/session-control-by-likhon.git
```

---

## 🧪 Testing

The plugin includes a test suite verifying all 14 core invariants:
```bash
npm test
```

Key verified test suites:
- Durable message targeting by ID across multiple turns
- Preservation of file attachments, tool calls, and reasoning frames
- Clean turn isolation (deleting output preserves user prompt; deleting turn removes tools & outputs)
- Mute/Ghost exclusion and lossless unmuting
- Protection against context leakage through compaction summaries
- Safe rejection of stale revisions and unfinalized in-progress turns
- Restart survival without altering raw session replay logs

---

## 📄 License

MIT © [Tanvir Ahamed Likhon](mailto:likhonmain@gmail.com)
