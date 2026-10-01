window.__ModuleLoader__.load({
  id: 'dsh-session-control',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useEffect, useSyncExternalStore } = React;
    /* SHARED_CORE */
    const resources = new Map();
    const bindings = new Map();
    let modal = null;
    const modalListeners = new Set();
    function setModal(value) { modal = value; for (const notify of modalListeners) notify(); }
    const modalSubscribe = notify => { modalListeners.add(notify); return () => modalListeners.delete(notify); };
    const modalSnapshot = () => modal;
    const CSS = `
      .sc-actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0;align-items:center}
      .sc-actions button,.sc-dialog button{border:1px solid #5556;background:#8881;color:inherit;border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit;font-size:12px}
      .sc-actions button:disabled,.sc-dialog button:disabled{opacity:.45;cursor:wait}
      .sc-actions .sc-muted{border-color:#bc83ea;background:#bc83ea22}
      .sc-error{color:#f78b8b;font-size:12px;max-width:650px}
      .sc-overlay{position:fixed;inset:0;z-index:10000;background:#0009;display:flex;align-items:center;justify-content:center;padding:20px}
      .sc-dialog{width:min(800px,95vw);max-height:90vh;overflow:auto;border:1px solid #555;background:var(--background,#18181b);color:var(--foreground,#eee);border-radius:12px;padding:20px;box-shadow:0 10px 60px #0008}
      .sc-dialog h2{font-size:18px;margin:0 0 8px}.sc-dialog label{display:block;margin:12px 0 6px}
      .sc-dialog textarea{box-sizing:border-box;width:100%;min-height:280px;background:#0002;color:inherit;border:1px solid #666;border-radius:6px;padding:10px;font:14px/1.5 monospace}
      .sc-dialog select{width:100%;background:#252529;color:inherit;border:1px solid #666;padding:8px;border-radius:6px}
      .sc-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.sc-title{opacity:.6;font-size:11px}.sc-dialog pre{white-space:pre-wrap;max-height:260px;overflow:auto}
    `;
    async function request(url, body) {
      const response = await fetch('/api/session-control/' + url, body === undefined
        ? { credentials: 'same-origin', cache: 'no-store' }
        : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    }
    function resource(id) {
      if (resources.has(id)) return resources.get(id);
      let snapshot = { loading: true }, inflight, timer;
      const listeners = new Set();
      const publish = next => { snapshot = next; for (const fn of listeners) fn(); };
      const value = {
        snapshot: () => snapshot,
        subscribe(fn) {
          listeners.add(fn); value.load();
          if (!timer) timer = setInterval(() => value.load(), 2000);
          return () => { listeners.delete(fn); if (!listeners.size) { clearInterval(timer); timer = undefined; } };
        },
        set(data) {
          if (snapshot.state?.revision > data.state.revision) return;
          const changed = snapshot.state?.revision !== data.state.revision;
          publish(data); if (changed) repaint(id, data.state);
        },
        async load() {
          if (inflight) return inflight;
          inflight = request('info?sessionId=' + encodeURIComponent(id)).then(value.set, error => publish({ ...snapshot, loading: false, error: error.message }));
          try { await inflight; } finally { inflight = undefined; }
        }
      };
      resources.set(id, value); return value;
    }
    function projectWindow(window, state) {
      return projectDisplayWindow(window, state);
    }
    function repaint(id, state) {
      for (const record of bindings.get(id) || []) record.replace.call(record.binding, projectWindow(record.source.getSnapshot(), state));
    }
    function adapt(binding, owner) {
      const id = owner.sessionId;
      let records = bindings.get(id);
      if (!records) bindings.set(id, records = new Set());
      if ([...records].some(record => record.binding === binding)) return;
      const record = { binding, source: owner.eventSource, replace: binding.replace, accept: binding.accept };
      records.add(record);
      binding.replace = function (window) { return record.replace.call(this, projectWindow(window, resource(id).snapshot().state)); };
      binding.accept = function (window) {
        const state = resource(id).snapshot().state;
        return record.accept.call(this, projectWindow(window, state));
      };
      owner.ctx.effect(() => () => { records.delete(record); if (!records.size) bindings.delete(id); });
      resource(id).load();
      const state = resource(id).snapshot().state;
      if (state) repaint(id, state);
    }
    async function mutate(id, data, action, turn, extra = {}) {
      const result = await request('mutate', { sessionId: id, action, startSeq: turn.startSeq, expectedRevision: data.state.revision, ...extra });
      resource(id).set(result);
    }
    function TurnActions(props) {
      const id = props.sessionId || props.session?.id;
      const turnNumber = typeof props.turn === 'number' ? props.turn : props.turn?.turn;
      if (!id || turnNumber === undefined) return null;
      return h(Controls, { id, turnNumber });
    }
    function Controls({ id, turnNumber }) {
      const value = resource(id);
      const data = useSyncExternalStore(value.subscribe, value.snapshot);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const turn = data.turns?.find(t => t.turn === turnNumber);
      if (!turn) return data.error ? h('div', { className: 'sc-error' }, DISPLAY_NAME + ': ' + data.error) : null;
      const disabled = busy || data.busy || turn.endSeq === null;
      const act = async action => {
        setError('');
        if (action.includes('input') || action.includes('output')) {
          const messages = action.endsWith('input') ? turn.userMessages : turn.assistantMessages;
          if (!messages.length) { setError('No matching message remains in this turn.'); return; }
          setModal({ id, data, turn, action, messages }); return;
        }
        if (action === 'delete-turn' && !window.confirm('Remove this entire turn from the conversation and future model context?')) return;
        setBusy(true);
        try { await mutate(id, data, action, turn); }
        catch (err) { setError(err.message); await value.load(); }
        finally { setBusy(false); }
      };
      const actions = [
        ['edit-output', 'Edit output'], ['edit-input', 'Edit input'],
        ['delete-output', 'Delete output'], ['delete-input', 'Delete input'],
        ['delete-turn', 'Remove turn'], ['toggle-mute', turn.muted ? 'Unmute' : 'Mute / Ghost']
      ];
      return h('div', null,
        h('div', { className: 'sc-actions', 'aria-label': DISPLAY_NAME },
          ...actions.map(([action, label]) => h('button', {
            key: action, type: 'button', disabled, onClick: () => act(action),
            className: action === 'toggle-mute' && turn.muted ? 'sc-muted' : undefined,
            title: action === 'toggle-mute' ? 'Keep this turn visible and exclude it from future API payloads; unmute to restore.' : label
          }, label)), h('span', { className: 'sc-title' }, turn.muted ? 'Ghosted · excluded from API context' : DISPLAY_NAME)),
        (error || data.error) && h('div', { role: 'alert', className: 'sc-error' }, error || data.error));
    }
    function Overlay() {
      const current = useSyncExternalStore(modalSubscribe, modalSnapshot);
      return current ? h(Editor, { key: current.id + ':' + current.action + ':' + current.turn.startSeq, ...current }) : null;
    }
    function Editor({ id, data, turn, action, messages }) {
      const [selected, setSelected] = useState(action.endsWith('output') ? messages.at(-1).id : messages[0].id);
      const [text, setText] = useState(messages.find(m => m.id === selected).text);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const deleting = action.startsWith('delete');
      useEffect(() => {
        const handler = event => { if (event.key === 'Escape' && !busy) setModal(null); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
      }, [busy]);
      const save = async event => {
        event.preventDefault(); setBusy(true); setError('');
        try { await mutate(id, data, action, turn, { messageId: selected, ...(deleting ? {} : { text }) }); setModal(null); }
        catch (err) { setError(err.message); await resource(id).load(); }
        finally { setBusy(false); }
      };
      return h('div', { className: 'sc-overlay' }, h('form', { className: 'sc-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': action.replace('-', ' '), onSubmit: save },
        h('h2', null, DISPLAY_NAME), h('div', null, action.replace('-', ' ') + ' · Turn ' + turn.turn),
        h('label', { htmlFor: 'sc-message' }, 'Message'),
        h('select', { id: 'sc-message', value: selected, disabled: busy, onChange: event => { setSelected(event.target.value); setText(messages.find(m => m.id === event.target.value).text); } },
          ...messages.map((message, index) => h('option', { value: message.id, key: message.id }, `${index + 1}. ${message.text.slice(0, 110) || '(no visible text)'}`))),
        deleting ? h('pre', null, text || '(no visible text)') : h('textarea', { autoFocus: true, value: text, onChange: event => setText(event.target.value), disabled: busy, 'aria-label': 'Message text' }),
        h('p', { className: 'sc-title' }, deleting ? 'This change also applies to future model context.' : 'Save updates this message and future model context. It does not resend your input.'),
        error && h('div', { className: 'sc-error', role: 'alert' }, error),
        h('footer', null, h('button', { type: 'button', disabled: busy, onClick: () => setModal(null) }, 'Cancel'),
          h('button', { type: 'submit', disabled: busy || (!deleting && !text.trim()) }, busy ? 'Saving…' : deleting ? 'Delete message' : 'Save'))));
    }
    return {
      inject: ['slots', 'sessions', 'uiConversation'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style'); style.dataset.plugin = 'dsh-session-control'; style.textContent = CSS;
          document.head.appendChild(style); return () => style.remove();
        });
        ctx.effect(() => {
          const original = ctx.uiConversation.binding;
          const wrapped = function (source) {
            const binding = original.call(this, source);
            adapt(binding, typeof source === 'string' ? ctx.sessions.binding(source) : source); return binding;
          };
          ctx.uiConversation.binding = wrapped;
          for (const record of ctx.uiConversation.bindings.values) adapt(record.binding, record.source);
          return () => {
            if (ctx.uiConversation.binding === wrapped) ctx.uiConversation.binding = original;
            for (const records of bindings.values()) for (const record of records) {
              record.binding.replace = record.replace; record.binding.accept = record.accept;
              record.replace.call(record.binding, record.source.getSnapshot());
            }
            bindings.clear(); setModal(null);
          };
        });
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'session-control-overlay', order: 10 }, Overlay));
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'session-control-turn', order: 99 }, TurnActions));
      }
    };
  }
});
