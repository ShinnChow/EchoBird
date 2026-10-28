window.__echobirdProduct = (invoke, context) => {
  const handlers = new Map();
  const events = new Map();
  const subscriptions = new Map();
  const transition = (topic, operation) => {
    const previous = subscriptions.get(topic) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => call(operation, { key: topic }));
    subscriptions.set(topic, next);
    return next;
  };
  const running = new Map();
  const cleanup = new Set();
  const call = (operation, params = {}) => invoke('plugin_host_call', { operation, input: params });
  const register = (kind, id, handler) => {
    const ids = kind === 'command' ? context.commands : context.textProcessors;
    if (!ids.includes(id) || typeof handler !== 'function') throw new Error('Undeclared extension handler');
    const key = `${kind}:${id}`;
    if (handlers.has(key)) throw new Error('Extension handler already registered');
    handlers.set(key, handler);
    return { dispose: () => { if (handlers.get(key) === handler) handlers.delete(key); } };
  };
  window.__echobirdDispatch = async ({ requestId, kind, id, input }) => {
    const controller = new AbortController();
    running.set(requestId, controller);
    try {
      const handler = handlers.get(`${kind}:${id}`);
      if (!handler) throw new Error('Extension handler not registered');
      const result = await handler(input, { signal: controller.signal });
      if (!controller.signal.aborted) await invoke('plugin_host_result', { id: requestId, value: result ?? null, error: null });
    } catch {
      if (!controller.signal.aborted) await invoke('plugin_host_result', { id: requestId, value: null, error: 'Extension failed' }).catch(() => {});
    } finally { running.delete(requestId); }
  };
  window.__echobirdCancel = (id) => running.get(id)?.abort();
  window.__echobirdEvent = ({ topic, value }) => {
    for (const handler of events.get(topic)?.handlers ?? []) Promise.resolve().then(() => handler(value)).catch(() => {});
  };
  window.addEventListener('load', () => { void call('ready').catch(() => {}); }, { once: true });
  window.addEventListener('beforeunload', () => {
    for (const controller of running.values()) controller.abort();
    for (const dispose of cleanup) { try { dispose(); } catch { /* Host revocation still owns cleanup. */ } }
    handlers.clear(); events.clear(); subscriptions.clear(); cleanup.clear();
  }, { once: true });
  return {
    configuration: Object.freeze({
      get: (key = '') => call('configuration.get', { key }),
      update: (key, value) => call('configuration.update', { key, value }),
      reset: (key) => call('configuration.reset', { key }),
    }),
    storage: Object.freeze({
      get: (key) => call('storage.get', { key }),
      set: (key, value) => call('storage.set', { key, value }),
      delete: (key) => call('storage.delete', { key }),
    }),
    commands: Object.freeze({ register: (id, handler) => register('command', id, handler), execute: (key, input = null) => call('commands.execute', { key, input }) }),
    text: Object.freeze({ register: (id, handler) => register('text', id, handler) }),
    events: Object.freeze({
      on: async (topic, handler) => {
        if (typeof handler !== 'function') throw new Error('Event handler must be a function');
        let subscription = events.get(topic);
        if (!subscription) {
          subscription = { handlers: new Set(), ready: transition(topic, 'events.subscribe') };
          events.set(topic, subscription);
        }
        subscription.handlers.add(handler);
        try { await subscription.ready; }
        catch (error) { if (events.get(topic) === subscription) events.delete(topic); throw error; }
        let disposed = false;
        return { dispose: async () => {
          if (disposed) return;
          disposed = true;
          subscription.handlers.delete(handler);
          if (!subscription.handlers.size && events.get(topic) === subscription) {
            events.delete(topic);
            await transition(topic, 'events.unsubscribe');
          }
        } };
      },
      emit: (topic, value = null) => call('events.emit', { key: `${context.pluginId}.${topic}`, value }),
    }),
    lifecycle: Object.freeze({ onDispose: (handler) => { cleanup.add(handler); return { dispose: () => cleanup.delete(handler) }; } }),
  };
};
