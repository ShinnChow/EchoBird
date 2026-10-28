import { beforeEach, expect, it, vi } from 'vitest';
import * as api from '../api/plugins';
import type { PluginProductState } from '../api/plugins';
import { useNavigationStore } from './navigationStore';
import { usePluginProductStore as store } from './pluginProductStore';
vi.mock('../api/plugins', () => ({
  getPluginProductState: vi.fn(),
  managePluginProduct: vi.fn(),
  executePluginCommand: vi.fn(),
}));
const snapshot: PluginProductState = {
  theme: null,
  palette: null,
  processors: [],
  configuration: { 'fixture.text': { enabled: true } },
  errors: {},
};
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  return {
    promise: new Promise<T>((a, b) => {
      resolve = a;
      reject = b;
    }),
    resolve,
    reject,
  };
};
beforeEach(() => {
  vi.resetAllMocks();
  useNavigationStore.getState().setDeveloperMode(true);
  store.getState().reset();
  vi.mocked(api.getPluginProductState).mockResolvedValue(snapshot);
});
it('loads contributions without invoking a command or changing configuration', async () => {
  await store.getState().load();
  expect(store.getState().snapshot).toEqual(snapshot);
  expect(api.executePluginCommand).not.toHaveBeenCalled();
  expect(api.managePluginProduct).not.toHaveBeenCalled();
});
it('ignores stale list results and leaves the latest state in place', async () => {
  const slow = deferred<typeof snapshot>();
  vi.mocked(api.getPluginProductState).mockReturnValueOnce(slow.promise);
  const pending = store.getState().load();
  await store.getState().load();
  slow.resolve({ ...snapshot, configuration: {} });
  await pending;
  expect(store.getState().snapshot).toEqual(snapshot);
});
it('clears active effects on pause and ignores late results after re-enabling', async () => {
  const slow = deferred<unknown>();
  vi.mocked(api.executePluginCommand).mockReturnValueOnce(slow.promise);
  const pending = store.getState().execute('fixture.text', 'format', {});
  useNavigationStore.getState().setDeveloperMode(false);
  store.getState().reset();
  useNavigationStore.getState().setDeveloperMode(true);
  slow.resolve('late');
  await expect(pending).rejects.toThrow('closed');
  expect(store.getState().error).toBeNull();
  expect(store.getState().busy).toBe(false);
});
it('does not let an old management completion clear the new request busy state', async () => {
  const first = deferred<void>(),
    second = deferred<void>();
  vi.mocked(api.managePluginProduct)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const a = store.getState().manage(null, 'theme', '');
  store.getState().reset();
  const b = store.getState().manage('fixture.text', 'processor', 'clean', true);
  first.resolve();
  await a;
  expect(store.getState().busy).toBe(true);
  second.resolve();
  await b;
  expect(store.getState().busy).toBe(false);
  expect(api.getPluginProductState).toHaveBeenCalledTimes(1);
});
it('blocks all product operations while developer preview is disabled', async () => {
  useNavigationStore.getState().setDeveloperMode(false);
  await store.getState().load();
  await store.getState().manage(null, 'theme', '');
  await store.getState().execute('fixture.text', 'format', {});
  expect(api.getPluginProductState).not.toHaveBeenCalled();
  expect(api.managePluginProduct).not.toHaveBeenCalled();
  expect(api.executePluginCommand).not.toHaveBeenCalled();
});

it('invalidates requests even when pause and resume happen before a render', async () => {
  const slow = deferred<PluginProductState>();
  vi.mocked(api.getPluginProductState).mockReturnValueOnce(slow.promise);
  const pending = store.getState().load();
  useNavigationStore.getState().setDeveloperMode(false);
  useNavigationStore.getState().setDeveloperMode(true);
  slow.resolve(snapshot);
  await pending;
  expect(store.getState().snapshot.configuration).toEqual({});
});
