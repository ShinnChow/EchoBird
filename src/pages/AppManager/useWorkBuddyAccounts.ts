import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../api/tauri';
import { accountError } from '../../utils/accountError';
import { useI18n } from '../../hooks/useI18n';
import { useConfirm } from '../../components/ConfirmDialog';

export function useWorkBuddyAccounts(
  edition: api.WorkBuddyEdition | null,
  hasModel: boolean,
  clearModel: (edition: api.WorkBuddyEdition) => void,
  showError: (error: string) => void
) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [accountsByEdition, setAccountsByEdition] = useState<
    Partial<Record<api.WorkBuddyEdition, api.WorkBuddyAccount[]>>
  >({});
  const [selected, setSelected] = useState<Partial<Record<api.WorkBuddyEdition, string | null>>>(
    {}
  );
  const [busy, setBusy] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const refreshingRef = useRef(new Set<string>());
  const generation = useRef(0);
  const adding = useRef(false);
  const pending = useRef<api.WorkBuddyLogin | null>(null);
  const hasModelRef = useRef(hasModel);
  useEffect(() => {
    hasModelRef.current = hasModel;
  }, [hasModel]);
  const selectedId = edition && !hasModel ? (selected[edition] ?? null) : null;

  const reload = useCallback(async () => {
    if (!edition) return;
    const current = generation.current;
    const result = await api.listWorkBuddyAccounts(edition);
    if (current === generation.current)
      setAccountsByEdition((prev) => ({ ...prev, [edition]: result }));
  }, [edition]);

  const refresh = useCallback(
    async (account: api.WorkBuddyAccount, quiet = false) => {
      if (refreshingRef.current.has(account.id)) return;
      const current = generation.current;
      refreshingRef.current.add(account.id);
      setRefreshing(new Set(refreshingRef.current));
      try {
        const updated = await api.refreshWorkBuddyAccountQuota(account.edition, account.id);
        setAccountsByEdition((prev) => ({
          ...prev,
          [updated.edition]: (prev[updated.edition] ?? []).map((a) =>
            a.id === updated.id ? updated : a
          ),
        }));
      } catch (error) {
        if (!quiet && current === generation.current) showError(accountError(error, t));
      } finally {
        refreshingRef.current.delete(account.id);
        setRefreshing(new Set(refreshingRef.current));
      }
    },
    [showError, t]
  );

  useEffect(() => {
    const current = ++generation.current;
    const timer = setTimeout(() => {
      setBusy(false);
      if (!edition) return;
      void api
        .listWorkBuddyAccounts(edition)
        .then((result) => {
          if (current !== generation.current) return;
          setAccountsByEdition((prev) => ({ ...prev, [edition]: result }));
          if (!hasModelRef.current)
            setSelected((prev) => ({
              ...prev,
              [edition]: result.some((a) => a.id === prev[edition])
                ? prev[edition]
                : (result.find((a) => a.active)?.id ?? null),
            }));
        })
        .catch((error) => {
          if (current === generation.current) showError(accountError(error, t));
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
      adding.current = false;
      const login = pending.current;
      pending.current = null;
      if (login) void api.cancelWorkBuddyLogin(login.loginId).catch(() => {});
    };
  }, [edition, showError, t]);

  const select = (id: string | null) => {
    if (!edition) return;
    setSelected((prev) => ({ ...prev, [edition]: id }));
    if (id) clearModel(edition);
  };
  const add = async () => {
    if (!edition || adding.current) return;
    const current = generation.current;
    adding.current = true;
    setBusy(true);
    setRemainingSeconds(120);
    let login: api.WorkBuddyLogin | null = null;
    let ticker: ReturnType<typeof setInterval> | undefined;
    try {
      login = await api.startWorkBuddyLogin(edition);
      if (current !== generation.current) return;
      pending.current = login;
      const expires = login.expiresAt;
      ticker = setInterval(() => {
        if (current === generation.current)
          setRemainingSeconds(Math.max(0, Math.ceil(expires - Date.now() / 1000)));
      }, 250);
      await api.openExternal(login.verificationUri);
      while (current === generation.current && Date.now() / 1000 < expires) {
        const account = await api.pollWorkBuddyLogin(login.loginId);
        if (current !== generation.current) return;
        if (account) {
          pending.current = null;
          await reload();
          if (current !== generation.current) return;
          select(account.id);
          void refresh(account, true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (current === generation.current) throw new Error('accountError.expired');
    } catch (error) {
      if (current === generation.current) showError(accountError(error, t));
    } finally {
      clearInterval(ticker);
      if (login) void api.cancelWorkBuddyLogin(login.loginId).catch(() => {});
      if (current === generation.current) {
        pending.current = null;
        adding.current = false;
        setBusy(false);
      }
    }
  };
  const remove = async (account: api.WorkBuddyAccount) => {
    if (
      !(await confirm({
        title: t('agent.deleteAccountTitle'),
        confirmText: t('btn.delete'),
        type: 'danger',
        message: t('agent.deleteAccountConfirm').replace('{email}', account.name),
      }))
    )
      return;
    const current = generation.current;
    try {
      await api.deleteWorkBuddyAccount(account.edition, account.id);
      setAccountsByEdition((prev) => ({
        ...prev,
        [account.edition]: (prev[account.edition] ?? []).filter((a) => a.id !== account.id),
      }));
      setSelected((prev) => ({
        ...prev,
        [account.edition]: prev[account.edition] === account.id ? null : prev[account.edition],
      }));
      if (current === generation.current) await reload();
    } catch (error) {
      if (current === generation.current) showError(accountError(error, t));
    }
  };
  return {
    accounts: edition ? (accountsByEdition[edition] ?? []) : [],
    selectedId,
    select,
    busy,
    remainingSeconds,
    refreshing,
    add,
    refresh,
    remove,
    reload,
  };
}
