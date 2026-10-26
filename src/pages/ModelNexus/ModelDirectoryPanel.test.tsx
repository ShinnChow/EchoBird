import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DirectoryRow } from '../../components/DirectoryRow';
import * as api from '../../api/tauri';
import { ModelNexusPanel } from './ModelNexus';

const { setNewModelForm, setEditingModelId, setShowAddModelModal } = vi.hoisted(() => ({
  setNewModelForm: vi.fn(),
  setEditingModelId: vi.fn(),
  setShowAddModelModal: vi.fn(),
}));
vi.mock('./context', async (original) => ({
  ...(await original<typeof import('./context')>()),
  useModelNexus: () => ({ setNewModelForm, setEditingModelId, setShowAddModelModal }),
}));
vi.mock('../../api/tauri', () => ({ getModelDirectory: vi.fn() }));
vi.mock('../../components/DirectoryRow', () => ({ DirectoryRow: () => null }));
vi.mock('../../components', () => ({
  getModelIcon: () => null,
  ModelCard: () => null,
  ModelCardSkeleton: () => null,
}));
vi.mock('../../hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'zh-Hans' }),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn() }));

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  renderer = undefined;
});
afterEach(() => {
  act(() => renderer?.unmount());
});

it.each([
  {
    name: 'Legacy remote',
    url: 'https://fixture.test',
    baseUrl: 'https://api.deepseek.com',
    anthropicUrl: 'https://api.deepseek.com/anthropic',
    region: 'global' as const,
    modelId: 'retired-default',
    modelIds: ['retired-other', 'retired-default'],
  },
  {
    name: 'No presets',
    url: 'https://fixture.test',
    baseUrl: 'https://fixture.test/v1',
    anthropicUrl: '',
    region: 'global' as const,
  },
])('opens $name without choosing a static model ID', async (entry) => {
  vi.mocked(api.getModelDirectory).mockResolvedValue({ providers: [entry], relays: [] });
  await act(async () => {
    renderer = create(<ModelNexusPanel />);
  });
  const row = renderer!.root
    .findAllByType(DirectoryRow)
    .find((row) => row.props.name === entry.name)!;
  act(() => row.props.add.onClick());
  expect(setNewModelForm).toHaveBeenCalledOnce();
  expect(setNewModelForm.mock.calls[0][0]).toMatchObject({
    name: entry.name,
    baseUrl: entry.baseUrl,
    modelId: '',
    apiKey: '',
  });
  expect(setNewModelForm.mock.calls[0][0].modelIdOptions).toEqual([]);
  expect(setEditingModelId).toHaveBeenCalledExactlyOnceWith(null);
  expect(setShowAddModelModal).toHaveBeenCalledExactlyOnceWith(true);
  expect(api.getModelDirectory).toHaveBeenCalledOnce();
});

it('keeps necessary unsupported-plan suggestions with a remote default, leaving discovery to choose first', async () => {
  const entry = {
    name: 'BytePlus',
    url: 'https://fixture.test',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
    anthropicUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding',
    region: 'global' as const,
    modelId: 'updated-preset',
    modelIds: ['other-preset', 'updated-preset'],
  };
  vi.mocked(api.getModelDirectory).mockResolvedValue({ providers: [entry], relays: [] });
  await act(async () => {
    renderer = create(<ModelNexusPanel />);
  });
  act(() => renderer!.root.findByType(DirectoryRow).props.add.onClick());
  expect(setNewModelForm.mock.calls[0][0]).toMatchObject({
    modelId: '',
    modelIdOptions: ['updated-preset', 'other-preset'],
  });
});
