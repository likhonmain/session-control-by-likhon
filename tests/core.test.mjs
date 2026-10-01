import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyState, indexTurns, mutateState, projectMessages, projectDisplayEntries, projectDisplayWindow, textOf, messageOf, describeTurns } from '../core.js';
import { StateStore } from '../state-store.js';
import { installContextAdapter } from '../index.js';
import { fixture, Session, createUserMessage } from './harness.mjs';

const change = (session, state, action, turn = 1, extra = {}) => mutateState(state, session.snapshotEvents(), {
  action, startSeq: indexTurns(session.snapshotEvents()).find(t => t.turn === turn).startSeq, expectedRevision: state.revision, ...extra
});
const context = (session, state) => projectMessages(session.deriveMessages(), session.snapshotEvents(), state, e => session.deriveEventMessage(e));
for (const role of ['input', 'output']) test(`edit earlier ${role}: durable ID targeting, future context, raw log untouched`, () => {
  const session = fixture({ duplicates: true });
  const before = JSON.stringify(session.snapshotEvents());
  const turn = indexTurns(session.snapshotEvents())[0];
  const target = (role === 'input' ? turn.userMessages : turn.assistantMessages).at(-1);
  const state = change(session, emptyState(session.header), `edit-${role}`, 1, { messageId: target.id, text: 'new text\n$math$' });
  const model = context(session, state);
  assert.equal(textOf(model.find(m => m.id === target.id)), 'new text\n$math$');
  assert.equal(model.filter(m => textOf(m) === 'new text\n$math$').length, 1);
  assert.equal(model.find(m => m.id === target.id).source.replayState, undefined);
  assert.equal(JSON.stringify(session.snapshotEvents()), before);
  assert.equal(textOf(messageOf(projectDisplayEntries(session.snapshotEvents(), state).find(e => e.seq === target.seq))), 'new text\n$math$');
});
test('edit collapses multiple text blocks once and preserves attachments', () => {
  const session = fixture();
  const events = structuredClone(session.snapshotEvents());
  const target = events.find(e => e.type === 'user/message');
  target.data.content = [{ type: 'text', text: 'a' }, { type: 'image', url: 'test' }, { type: 'text', text: 'b' }];
  const state = mutateState(emptyState(session.header), events, { action: 'edit-input', startSeq: 1, expectedRevision: 0, messageId: target.data.id, text: 'once' });
  const projected = projectDisplayEntries(events, state).find(e => e.seq === target.seq).data;
  assert.equal(projected.content.filter(b => b.type === 'text').length, 1);
  assert.equal(projected.content[1].type, 'image');
});
test('delete input keeps outputs, tools and other turns', () => {
  const session = fixture(), t = indexTurns(session.snapshotEvents())[0];
  const state = change(session, emptyState(session.header), 'delete-input', 1, { messageId: t.userMessages[0].id });
  const model = context(session, state);
  assert(!model.some(m => m.id === t.userMessages[0].id));
  assert(model.some(m => m.role === 'tool'));
  assert(model.some(m => textOf(m) === 'output 1'));
  assert(model.some(m => textOf(m) === 'input 2'));
});
test('delete output removes selected answer from payload and settles empty display response', () => {
  const session = fixture(), t = indexTurns(session.snapshotEvents())[0], target = t.assistantMessages.at(-1);
  const state = change(session, emptyState(session.header), 'delete-output', 1, { messageId: target.id });
  assert(!context(session, state).some(m => m.id === target.id));
  assert.equal(projectDisplayEntries(session.snapshotEvents(), state).find(e => e.seq === target.seq).data.message.content.length, 0);
  assert.equal(describeTurns(session.snapshotEvents(), state)[0].assistantMessages.length, 1);
});
test('delete intermediate output preserves paired tool calls/results and thinking', () => {
  const session = fixture(), t = indexTurns(session.snapshotEvents())[0], target = t.assistantMessages[0];
  const state = change(session, emptyState(session.header), 'delete-output', 1, { messageId: target.id });
  const model = context(session, state), assistant = model.find(m => m.id === target.id);
  assert.deepEqual(assistant.content.map(b => b.type), ['reasoning', 'tool-call']);
  assert.equal(model.find(m => m.role === 'tool').toolCallId, assistant.content[1].id);
});
for (const action of ['delete-turn', 'toggle-mute']) test(`${action} excludes input/output/tools/thinking together`, () => {
  const session = fixture(), before = JSON.stringify(session.snapshotEvents());
  const state = change(session, emptyState(session.header), action);
  const model = context(session, state);
  assert.deepEqual(model.map(textOf), ['system instruction', 'input 2', 'output 2', 'input 3', 'output 3']);
  const display = projectDisplayEntries(session.snapshotEvents(), state);
  assert.equal(display.some(e => e.type === 'tool/result'), action === 'toggle-mute');
  assert.equal(JSON.stringify(session.snapshotEvents()), before);
});
test('unmute restores edited content, not an outdated original', () => {
  const session = fixture(), target = indexTurns(session.snapshotEvents())[0].userMessages[0];
  let state = change(session, emptyState(session.header), 'edit-input', 1, { messageId: target.id, text: 'updated' });
  state = change(session, state, 'toggle-mute');
  assert(!context(session, state).some(m => m.id === target.id));
  state = change(session, state, 'toggle-mute');
  assert.equal(textOf(context(session, state).find(m => m.id === target.id)), 'updated');
});
test('edited and muted content does not leak through nested compaction summaries', () => {
  const session = fixture({ tools: false }), events = session.snapshotEvents(), turns = indexTurns(events);
  const state = change(session, emptyState(session.header), 'toggle-mute');
  const sources = events.filter(e => e.surfaceOp === 'append' && e.seq > 0 && e.seq <= turns[1].endSeq).map(e => e.seq);
  const summary1 = createUserMessage({ content: [{ type: 'text', text: 'stale input 1 output 1 input 2 output 2' }], source: { kind: 'compaction' } });
  const e1 = session.append('user/message', summary1, { surfaceOp: { op: 'replace', startSeq: sources[0], endSeq: sources.at(-1) }, sourceEventSeqs: sources });
  const summary2 = createUserMessage({ content: [{ type: 'text', text: 'nested stale input 1' }], source: { kind: 'compaction' } });
  session.append('user/message', summary2, { surfaceOp: { op: 'replace', startSeq: e1.seq, endSeq: e1.seq }, sourceEventSeqs: [e1.seq] });
  assert.deepEqual(context(session, state).map(textOf), ['system instruction', 'input 2', 'output 2', 'input 3', 'output 3']);
});
test('unaffected compaction is preserved', () => {
  const session = fixture({ tools: false }), t = indexTurns(session.snapshotEvents());
  const sources = session.snapshotEvents().filter(e => e.surfaceOp === 'append' && e.seq > 0 && e.seq <= t[0].endSeq).map(e => e.seq);
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'summary 1' }], source: { kind: 'compaction' } }), { surfaceOp: { op: 'replace', startSeq: sources[0], endSeq: sources.at(-1) }, sourceEventSeqs: sources });
  const state = change(session, emptyState(session.header), 'toggle-mute', 3);
  assert.deepEqual(context(session, state).map(textOf), ['system instruction', 'summary 1', 'input 2', 'output 2']);
});
test('reject stale revisions, cross-turn IDs, and incomplete turns', () => {
  const session = fixture(), state = emptyState(session.header), turns = indexTurns(session.snapshotEvents());
  assert.throws(() => mutateState(state, session.snapshotEvents(), { action: 'toggle-mute', startSeq: turns[0].startSeq, expectedRevision: 5 }), /changed/);
  assert.throws(() => change(session, state, 'edit-input', 1, { messageId: turns[1].userMessages[0].id, text: 'invalid' }), /no longer exists/);
  session.append('turn/start', { turn: 4 });
  assert.throws(() => change(session, state, 'toggle-mute', 4), /completed/);
});
test('client window preserves entry wrappers, revision, pagination and incremental appends', () => {
  const session = fixture(), events = session.snapshotEvents(), turns = indexTurns(events);
  let state = change(session, emptyState(session.header), 'delete-turn', 1);
  state = change(session, state, 'edit-input', 3, { messageId: turns[2].userMessages[0].id, text: 'display changed' });
  const entries = events.map(event => ({ event, persisted: true }));
  const window = { entries, revision: 18, cursor: events.at(-1).seq, hasMore: true, change: { kind: 'append', entries: entries.slice(-6) } };
  const projected = projectDisplayWindow(window, state);
  assert.equal(projected.revision, window.revision); assert.equal(projected.cursor, window.cursor); assert.equal(projected.hasMore, true);
  assert(!projected.entries.some(e => e.event.seq >= turns[0].startSeq && e.event.seq <= turns[0].endSeq));
  assert(projected.change.entries.some(e => textOf(messageOf(e.event)) === 'display changed'));
  assert(projected.entries.every(e => e.persisted));
  assert.equal(textOf(entries.find(e => e.event.seq === turns[2].userMessages[0].seq).event.data), 'input 3');
});
test('sidecar + fresh Harness Session survive restart without changing replay log', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-state-test-'));
  try {
    const session = fixture(), original = JSON.stringify(session.snapshotEvents());
    const store = new StateStore(root);
    store.write(change(session, emptyState(session.header), 'toggle-mute'));
    const remove = installContextAdapter(session, store);
    assert(!session.deriveMessages().some(m => m.role === 'tool'));
    assert.equal(JSON.stringify(session.snapshotEvents()), original);
    remove();
    assert(session.deriveMessages().some(m => m.role === 'tool'));
    const reopened = Session.create(session.id, session.snapshotEvents(), session.header);
    installContextAdapter(reopened, new StateStore(root));
    assert.deepEqual(reopened.deriveMessages().map(textOf), ['system instruction', 'input 2', 'output 2', 'input 3', 'output 3']);
    assert.equal(new StateStore(root).read(session.header).revision, 1);
    assert.throws(() => store.read({ ...session.header, createdAt: 1 }), /another session/);
    fs.writeFileSync(store.filename(session.id), '{broken');
    assert.throws(() => reopened.deriveMessages());
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
