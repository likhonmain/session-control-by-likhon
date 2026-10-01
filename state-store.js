import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { emptyState } from './core.js';

// A separate, atomic sidecar. No event offsets, raw logs, or stream cursors change.
export class StateStore {
  constructor(directory) { this.directory = directory; }
  filename(id) { return path.join(this.directory, `${createHash('sha256').update(id).digest('hex')}.json`); }
  read(header) {
    let text;
    try { text = fs.readFileSync(this.filename(header.id), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return emptyState(header); throw error; }
    const state = JSON.parse(text);
    if (state.version !== 2 || state.sessionId !== header.id || state.createdAt !== header.createdAt || !Number.isSafeInteger(state.revision) || state.revision < 0 || !state.messages || !state.turns) {
      throw new Error('Session Control state is invalid or belongs to another session. Restore its sidecar backup before continuing.');
    }
    return state;
  }
  write(state) {
    fs.mkdirSync(this.directory, { recursive: true });
    const target = this.filename(state.sessionId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}
