import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StateStore } from './state-store.js';
import { DISPLAY_NAME, describeTurns, mutateState, projectMessages } from './core.js';

export const name = 'session-control';
export const inject = ['connection', 'sessions', 'agents', 'sessionQuery'];
const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));

export function installContextAdapter(session, store) {
  if (typeof session.deriveMessages !== 'function' || typeof session.deriveEventMessage !== 'function' || typeof session.snapshotEvents !== 'function') {
    throw new Error('This Harness version lacks the required session projection API.');
  }
  const original = session.deriveMessages;
  const wrapped = function () {
    const messages = original.call(this);
    const state = store.read(this.header);
    return projectMessages(messages, state.revision ? this.snapshotEvents() : [], state, event => this.deriveEventMessage(event));
  };
  session.deriveMessages = wrapped;
  return () => { if (session.deriveMessages === wrapped) session.deriveMessages = original; };
}

export function apply(ctx) {
  const home = process.env.DSH_HOME || path.join(process.env.APPDATA, 'dsh-desktop', 'harness');
  const store = new StateStore(path.join(home, 'session-control', 'v2'));
  const adapters = new Map();
  const locks = new Map();
  function attach(session) {
    if (!adapters.has(session)) adapters.set(session, installContextAdapter(session, store));
  }
  ctx.on('session/created', attach);
  ctx.on('session/disposed', session => { adapters.get(session)?.(); adapters.delete(session); });
  for (const session of ctx.sessions.list()) attach(session);
  ctx.effect(() => () => { for (const dispose of adapters.values()) dispose(); adapters.clear(); });

  const json = value => Response.json(value, { headers: { 'cache-control': 'no-store' } });
  const route = (suffix, methods, handler) => ctx.connection.fetch.register({
    path: `/api/session-control/${suffix}`, methods, requestBody: 'buffered',
    fetch: async request => {
      try { return await handler(request); }
      catch (error) {
        return Response.json({ ok: false, error: error.message || String(error) }, {
          status: error.status || 409, headers: { 'cache-control': 'no-store' }
        });
      }
    }
  });
  async function observe(id, fn) {
    if (typeof id !== 'string' || !id || id.length > 250) throw new Error('A valid sessionId is required.');
    const lease = await ctx.sessionQuery.observeSession(id, { projectionMode: 'none' });
    try { return fn(lease.header, lease.events); }
    finally { lease[Symbol.dispose](); }
  }
  const info = (header, events) => {
    const state = store.read(header);
    return { ok: true, displayName: DISPLAY_NAME, state, turns: describeTurns(events, state),
      busy: ctx.agents.get(header.id)?.status === 'running' };
  };
  route('status', ['GET'], () => json({ ok: true, plugin: manifest.name, displayName: DISPLAY_NAME,
    version: manifest.version, build: 'sidecar-projection-v2', rawLogWrites: false }));
  route('info', ['GET'], request => observe(new URL(request.url).searchParams.get('sessionId'),
    (header, events) => json(info(header, events))));
  route('mutate', ['POST'], async request => {
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('JSON request required.');
    const text = await request.text();
    if (text.length > 1100000) throw new Error('Request is too large.');
    const body = JSON.parse(text);
    const id = body.sessionId;
    if (typeof id !== 'string' || !id || id.length > 250) throw new Error('A valid sessionId is required.');
    const previous = locks.get(id) || Promise.resolve();
    const operation = previous.catch(() => {}).then(() => observe(id, (header, events) => {
      if (ctx.agents.get(id)?.status === 'running') throw new Error('Wait until the current response finishes before editing this session.');
      const state = store.read(header);
      const next = mutateState(state, events, body);
      store.write(next);
      return json(info(header, events));
    }));
    locks.set(id, operation);
    try { return await operation; }
    finally { if (locks.get(id) === operation) locks.delete(id); }
  });
}
