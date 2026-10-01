// Shared by the host and the browser. This module never changes a session log.
export const ACTIONS = Object.freeze(['edit-output', 'edit-input', 'delete-output', 'delete-input', 'delete-turn', 'toggle-mute']);
export const DISPLAY_NAME = 'Session Control by Likhon';
export function emptyState(header) {
  return { version: 2, sessionId: header.id, createdAt: header.createdAt, revision: 0, messages: {}, turns: {} };
}
export function messageOf(event) {
  if (event.type === 'user/message') return event.data;
  if (['assistant/message', 'system/message', 'developer/message', 'tool/result'].includes(event.type)) return event.data.message;
  return null;
}
export function textOf(message) {
  return (message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}
export function indexTurns(events) {
  const turns = [];
  let active;
  for (const event of events) {
    if (event.type === 'turn/start') {
      active = { turn: event.data.turn, startSeq: event.seq, endSeq: null, userMessages: [], assistantMessages: [] };
      turns.push(active);
    }
    const turn = (event.data?.turn === undefined ? active : turns.findLast(t => t.turn === event.data.turn)) || active;
    if (!turn) continue;
    const message = messageOf(event);
    if (event.surfaceOp === 'append' && message?.id && (event.type === 'assistant/message' || (event.type === 'user/message' && message.source?.kind === 'user'))) {
      const record = { id: message.id, seq: event.seq, text: textOf(message) };
      (event.type === 'user/message' ? turn.userMessages : turn.assistantMessages).push(record);
    }
    if (event.type === 'turn/end') {
      turn.endSeq = event.seq;
      if (active === turn) active = undefined;
    }
  }
  return turns;
}
export function turnControl(event, state) {
  return Object.values(state.turns).find(t => event.seq >= t.startSeq && event.seq <= t.endSeq);
}
export function editedMessage(message, control) {
  if (!control) return message;
  let content;
  if (control.deleted) {
    // Keep the assistant tool protocol intact when removing its visible answer.
    content = message.role === 'assistant' ? message.content.filter(b => b.type === 'reasoning' || b.type === 'tool-call') : [];
  } else {
    let inserted = false;
    content = message.content.flatMap(b => {
      if (b.type !== 'text') return [b];
      if (inserted) return [];
      inserted = true;
      return [{ type: 'text', text: control.text }];
    });
    if (!inserted) content.push({ type: 'text', text: control.text });
  }
  if (!content.length) return null;
  const source = message.source ? { ...message.source } : undefined;
  if (source) delete source.replayState;
  return { ...message, content, ...(source ? { source } : {}) };
}
export function describeTurns(events, state) {
  return indexTurns(events).filter(t => !state.turns[t.startSeq]?.deleted).map(t => ({
    ...t, muted: !!state.turns[t.startSeq]?.muted,
    userMessages: t.userMessages.filter(m => !state.messages[m.id]?.deleted).map(m => ({ ...m, text: state.messages[m.id]?.text ?? m.text })),
    assistantMessages: t.assistantMessages.filter(m => !state.messages[m.id]?.deleted).map(m => ({ ...m, text: state.messages[m.id]?.text ?? m.text }))
  }));
}
export function mutateState(state, events, request) {
  if (!ACTIONS.includes(request.action)) throw new Error('Unknown session control action.');
  if (request.expectedRevision !== state.revision) throw new Error('Session controls changed. Reload and try again.');
  const turn = indexTurns(events).find(t => t.startSeq === request.startSeq);
  if (!turn || turn.endSeq === null || state.turns[turn.startSeq]?.deleted) throw new Error('Select an existing, completed turn.');
  const next = structuredClone(state);
  if (request.action === 'delete-turn' || request.action === 'toggle-mute') {
    const previous = next.turns[turn.startSeq] || {};
    next.turns[turn.startSeq] = { turn: turn.turn, startSeq: turn.startSeq, endSeq: turn.endSeq,
      deleted: request.action === 'delete-turn', muted: request.action === 'toggle-mute' ? !previous.muted : !!previous.muted };
  } else {
    const input = request.action.endsWith('input');
    const target = (input ? turn.userMessages : turn.assistantMessages).find(m => m.id === request.messageId);
    if (!target || next.messages[target.id]?.deleted) throw new Error('Selected message no longer exists.');
    const deleted = request.action.startsWith('delete');
    if (!deleted && (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 1000000)) throw new Error('Enter message text (up to 1,000,000 characters).');
    next.messages[target.id] = { seq: target.seq, role: input ? 'user' : 'assistant', ...(deleted ? { deleted: true } : { text: request.text }) };
  }
  next.revision++;
  return next;
}
export function projectDisplayEntries(events, state) {
  if (!state?.revision) return events;
  return events.filter(event => !turnControl(event, state)?.deleted).map(event => {
    const message = messageOf(event);
    const control = message && state.messages[message.id];
    if (!control) return event;
    const edited = editedMessage(message, control);
    // Display-only placeholder keeps sequence anchors stable. It is never persisted.
    if (!edited && event.type === 'assistant/message') {
      // Settle the original live stream with empty content so it cannot reappear.
      return { ...event, data: { ...event.data, message: { ...message, content: [] } } };
    }
    if (!edited) return { seq: event.seq, time: event.time, type: 'session/end-seed', data: {} };
    if (event.type === 'user/message') return { ...event, data: edited };
    return { ...event, data: { ...event.data, message: edited } };
  });
}
export function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
export function projectDisplayWindow(window, state) {
  if (!state?.revision) return window;
  const project = entries => {
    const events = new Map(projectDisplayEntries(entries.map(entry => entry.event), state).map(event => [event.seq, event]));
    return entries.filter(entry => events.has(entry.event.seq)).map(entry => {
      const event = events.get(entry.event.seq);
      return event === entry.event ? entry : { ...entry, event };
    });
  };
  const change = { ...window.change };
  if (change.entries) change.entries = project(change.entries);
  if (change.entry) change.entry = project([change.entry])[0];
  return { ...window, entries: project(window.entries), change };
}
export function projectMessages(messages, events, state, derive = messageOf) {
  if (!state?.revision) return messages;
  const bySeq = new Map(events.map(e => [e.seq, e]));
  const byId = new Map();
  const dependencies = new Map();
  const affected = new Set();
  let surface = [];
  for (const event of events) {
    const message = messageOf(event);
    if (message?.id) byId.set(message.id, event.seq);
    const turn = turnControl(event, state);
    if (state.messages[message?.id] || turn?.deleted || turn?.muted) affected.add(event.seq);
    if (event.surfaceOp === 'append') surface.push(event.seq);
    else if (event.surfaceOp?.op === 'replace') {
      const first = surface.indexOf(event.surfaceOp.startSeq), last = surface.indexOf(event.surfaceOp.endSeq);
      if (first < 0 || last < first) throw new Error('Cannot safely resolve compacted session context.');
      const shadowed = surface.slice(first, last + 1);
      dependencies.set(event.seq, shadowed);
      // Additional citations can make a summary depend on content outside its range.
      if ([...shadowed, ...(event.sourceEventSeqs || [])].some(seq => affected.has(seq))) affected.add(event.seq);
      surface.splice(first, last - first + 1, event.seq);
    }
  }
  const walk = (seq, currentMessage) => {
    const event = bySeq.get(seq);
    if (!event) throw new Error('Missing source event for controlled context.');
    const children = dependencies.get(seq);
    // A stale summary must not leak edited, removed, or muted content.
    if (children && affected.has(seq)) return children.flatMap(child => walk(child));
    const turn = turnControl(event, state);
    if (turn?.deleted || turn?.muted) {
      // Tool registry declarations and the base system prompt are infrastructure.
      if (event.type !== 'system/message' && messageOf(event)?.source?.kind !== 'tool-registry') return [];
    }
    const message = currentMessage || derive(event);
    if (!message) return [];
    const result = editedMessage(message, state.messages[message.id]);
    return result ? [freezeDeep(result)] : [];
  };
  return messages.flatMap(message => {
    const seq = byId.get(message.id);
    if (seq === undefined) throw new Error('Cannot identify a model message in the session log.');
    return walk(seq, message);
  });
}
