import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../api/tauri';
import { accountError } from '../../utils/accountError';
import { useI18n } from '../../hooks/useI18n';
import { useConfirm } from '../../components/ConfirmDialog';

export function useGrokAccounts(
  enabled: boolean,
  hasModel: boolean,
  clearModel: () => void,
  showError: (e: string) => void
) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState<api.GrokAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const pending = useRef<api.GrokLogin | null>(null);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const result = await api.listGrokAccounts();
    setAccounts(result);
    if (!hasModel)
      setSelectedId((id) =>
        result.some((a) => a.id === id) ? id : (result.find((a) => a.active)?.id ?? null)
      );
  }, [hasModel]);
  useEffect(() => {
    if (!enabled) return;
    const g = ++generation.current;
    const timer = setTimeout(
      () =>
        void reload().catch((e) => {
          if (g === generation.current) showError(accountError(e, t));
        }),
      0
    );
    return () => {
      clearTimeout(timer);
      generation.current++;
      const p = pending.current;
      if (p) void api.cancelGrokLogin(p.loginId).catch(() => {});
    };
  }, [enabled, reload, showError, t]);
  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) clearModel();
  };
  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const login = await api.startGrokLogin();
      pending.current = login;
      setRemainingSeconds(Math.max(0, Math.ceil(login.expiresAt - Date.now() / 1000)));
      const end = Date.now() + 60000;
      while (Date.now() < end) {
        const a = await api.pollGrokLogin(login.loginId);
        if (a) {
          pending.current = null;
          await reload();
          select(a.id);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error('accountError.expired');
    } catch (e) {
      showError(accountError(e, t));
    } finally {
      pending.current = null;
      setBusy(false);
      setRemainingSeconds(0);
    }
  };
  const remove = async (a: api.GrokAccount) => {
    if (
      !(await confirm({
        title: t('agent.deleteAccountTitle'),
        message: t('agent.deleteAccountConfirm').replace('{email}', a.email),
        confirmText: t('btn.delete'),
        type: 'danger',
      }))
    )
      return;
    try {
      await api.deleteGrokAccount(a.id);
      await reload();
    } catch (e) {
      showError(accountError(e, t));
    }
  };
  const switchAccount = async () => {
    if (!selectedId) return;
    try {
      await api.switchGrokAccount(selectedId);
      await reload();
    } catch (e) {
      showError(accountError(e, t));
    }
  };
  const refresh = async (account: api.GrokAccount) => {
    setRefreshing((current) => new Set(current).add(account.id));
    try {
      const updated = await api.refreshGrokAccount(account.id);
      setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (e) {
      showError(accountError(e, t));
    } finally {
      setRefreshing((current) => {
        const next = new Set(current);
        next.delete(account.id);
        return next;
      });
    }
  };
  return {
    accounts,
    selectedId: enabled && !hasModel ? selectedId : null,
    select,
    busy,
    remainingSeconds,
    add,
    remove,
    switchAccount,
    refresh,
    refreshing,
    reload,
  };
}
