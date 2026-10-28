import * as api from '../../api/tauri';
import { useManagedAccounts } from './useManagedAccounts';

const clients = {
  grokbot: {
    list: api.listGrokBotAccounts,
    start: api.startGrokBotLogin,
    poll: api.pollGrokBotLogin,
    cancel: api.cancelGrokBotLogin,
    remove: api.deleteGrokBotAccount,
    refresh: api.refreshGrokBotAccount,
  },
  cursor: {
    list: api.listCursorAccounts,
    start: api.startCursorLogin,
    poll: (id: string) => api.pollCursorLogin(id),
    cancel: api.cancelCursorLogin,
    remove: api.deleteCursorAccount,
    refresh: api.refreshCursorAccount,
  },
  cursorcli: {
    list: () => api.listCursorAccounts('cursorcli'),
    start: () => api.startCursorLogin('cursorcli'),
    poll: (id: string) => api.pollCursorLogin(id, 'cursorcli'),
    cancel: api.cancelCursorLogin,
    remove: api.deleteCursorAccount,
    refresh: (id: string) => api.refreshCursorAccount(id, 'cursorcli'),
  },
};

export function useCursorAccounts(
  tool: api.CursorTool | 'grokbot',
  enabled: boolean,
  clearModel: () => void,
  showError: (error: string) => void
) {
  const client = clients[tool];
  return useManagedAccounts<api.CursorAccount, api.CursorLogin>(
    tool === 'cursorcli' ? 'cursor' : tool,
    enabled,
    false,
    clearModel,
    showError,
    {
      ...client,
      open: (login) => api.openExternal(login.verificationUri),
      remove: (account) => client.remove(account.id),
      refresh: async (account) => ({ ...account, usage: await client.refresh(account.id) }),
      label: (account) => account.email,
    },
    tool
  );
}
