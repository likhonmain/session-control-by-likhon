import path from 'node:path';
import { pathToFileURL } from 'node:url';
export const modules = path.join(process.env.LOCALAPPDATA, 'Programs', 'DSH Desktop', 'resources', 'app.asar.unpacked', 'node_modules');
export const load = name => import(pathToFileURL(path.join(modules, '@deepseek-ai', name, 'lib', 'index.js')));
export const { Session } = await load('dsh-session');
export const { createUserMessage, createAssistantMessage, createSystemMessage, createToolResultMessage } = await load('dsh-llm');
export function fixture({ tools = true, duplicates = false } = {}) {
  const session = Session.create('session-sc-disposable', undefined, { version: 4, id: 'session-sc-disposable', isSeeded: false, createdAt: 1700000000000, cwd: process.cwd() });
  session.append('system/message', { message: createSystemMessage('system instruction') }, { surfaceOp: 'append' });
  for (let turn = 1; turn <= 3; turn++) {
    session.append('turn/start', { turn });
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: duplicates ? 'same text' : `input ${turn}` }], source: { kind: 'user' } }), { surfaceOp: 'append' });
    session.append('step/start', { turn, step: 1 });
    if (tools && turn === 1) {
      const call = { type: 'tool-call', id: 'call-1', name: 'test', arguments: '{}' };
      session.append('assistant/message', { turn, step: 1, message: createAssistantMessage({ content: [{ type: 'reasoning', text: 'private thinking' }, call, { type: 'text', text: 'intermediate answer' }], source: { provider: 'test', model: 'test' } }), stream: [] }, { surfaceOp: 'append' });
      session.append('tool/call', { turn, step: 1, callId: 'call-1', name: 'test', arguments: '{}' });
      session.append('tool/result', { turn, step: 1, message: createToolResultMessage({ callId: 'call-1', content: [{ type: 'text', text: 'tool secret' }], isError: false }) }, { surfaceOp: 'append' });
      session.append('step/end', { turn, step: 1 });
      session.append('step/start', { turn, step: 2 });
    }
    session.append('assistant/message', { turn, step: tools && turn === 1 ? 2 : 1,
      message: createAssistantMessage({ content: [{ type: 'text', text: duplicates ? 'same text' : `output ${turn}` }], source: { provider: 'test', model: 'test', replayState: { original: `output ${turn}` } } }), stream: [] }, { surfaceOp: 'append' });
    session.append('step/end', { turn, step: tools && turn === 1 ? 2 : 1 });
    session.append('turn/end', { turn, reason: 'completed' });
  }
  return session;
}
