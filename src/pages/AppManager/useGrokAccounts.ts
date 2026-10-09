import { useRef, useState } from 'react';
import * as api from '../../api/tauri';
import { useManagedAccounts } from './useManagedAccounts';

const clients = {
  grok: {
    list: api.listGrokAccounts,
    start: api.startGrokLogin,
    cancel: api.cancelGrokLogin,
    remove: api.deleteGrokAccount,
    switch: api.switchGrokAccount,
    refresh: api.refreshGrokAccount,
  },
  manus: {
    list: api.listManusAccounts,
    start: api.startManusLogin,
    cancel: api.cancelManusLogin,
    remove: api.deleteManusAccount,
    switch: api.switchManusAccount,
    refresh: api.refreshManusAccount,
  },
  cue: {
    list: api.listCueAccounts,
    start: api.startCueLogin,
    cancel: api.cancelCueLogin,
    remove: api.deleteCueAccount,
    switch: api.switchCueAccount,
    refresh: api.refreshCueAccount,
  },
};

export function useGrokAccounts(
  enabled: boolean,
  hasModel: boolean,
  clearModel: () => void,
  showError: (error: string) => void,
  tool: 'grok' | 'manus' | 'cue' = 'grok'
) {
  const client = clients[tool];
  const currentAttempt = useRef<string | null>(null);
  const startGeneration = useRef(0);
  const [exitAttempt, setExitAttempt] = useState<string | null>(null);
  const managed = useManagedAccounts<
    api.GrokAccount | api.ManusAccount,
    api.GrokLogin | api.ManusLogin
  >(tool, enabled, hasModel, clearModel, showError, {
    ...client,
    start: async () => {
      const generation = ++startGeneration.current;
      const login = await client.start();
      if (startGeneration.current === generation) {
        currentAttempt.current = login.loginId;
        setExitAttempt(null);
      }
      return login;
    },
    open: (login) =>
      'verificationUri' in login ? api.openExternal(login.verificationUri) : Promise.resolve(),
    poll: async (id, nextStage) => {
      if (tool === 'grok') return api.pollGrokLogin(id);
      const result = await (tool === 'cue' ? api.pollCueLogin(id) : api.pollManusLogin(id));
      if (currentAttempt.current === id) {
        setExitAttempt(result.awaitingClientExit ? id : null);
        if (result.awaitingClientExit && result.expiresAt !== null) nextStage(result.expiresAt);
      }
      return result.account;
    },
    cancel: (id) => {
      if (currentAttempt.current === id) {
        currentAttempt.current = null;
        setExitAttempt(null);
      }
      return client.cancel(id);
    },
    remove: (account) => client.remove(account.id),
    refresh: (account) => client.refresh(account.id),
    label: (account) => account.email,
  });
  const switchAccount = async () => {
    if (!managed.selectedId) return;
    await client.switch(managed.selectedId);
    await managed.reload();
  };
  return {
    ...managed,
    awaitingClientExit:
      tool !== 'grok' && enabled && managed.busy && exitAttempt === managed.login?.loginId,
    switchAccount,
  };
}
