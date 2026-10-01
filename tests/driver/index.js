export const name = 'session-control-test-driver';
export const inject = ['connection', 'sessionController', 'sessions', 'agents', 'sessionPersistence'];
export function apply(ctx) {
  const route = (action, handler) => ctx.connection.fetch.register({ path: '/api/sc-test/' + action,
    methods: ['POST'], requestBody: 'buffered', fetch: async request => {
      try { return Response.json({ ok: true, value: await handler(await request.json()) }); }
      catch (error) { return Response.json({ ok: false, error: error.message || String(error) }, { status: 500 }); }
    } });
  route('create', request => ctx.sessionController.create({ sessionId: request.sessionId, cwd: process.env.SC_TEST_CWD }));
  route('prompt', async request => {
    const session = ctx.sessions.get(request.sessionId);
    const previous = session.seq;
    await ctx.sessionController.prompt({ sessionId: request.sessionId, requestId: crypto.randomUUID(), content: [{ type: 'text', text: request.text }] }, AbortSignal.timeout(15000));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (session.seq > previous && session.snapshotEvents().slice(previous).some(e => e.type === 'turn/end') && ctx.agents.get(request.sessionId)?.status === 'idle') {
        await ctx.sessionPersistence.flush();
        return { events: session.snapshotEvents(), messages: session.deriveMessages() };
      }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Disposable model turn did not complete.');
  });
  route('read', request => {
    const session = ctx.sessions.get(request.sessionId);
    if (!session) throw new Error('Session not live.');
    return { header: session.header, events: session.snapshotEvents(), messages: session.deriveMessages() };
  });
}
