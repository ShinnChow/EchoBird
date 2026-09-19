import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../api/tauri';
import type { ClaudeCodeAccount } from '../../api/tauri';
import { useConfirm } from '../../components/ConfirmDialog';
import { useI18n } from '../../hooks/useI18n';

export function useClaudeCodeAccounts(
  enabled: boolean,
  hasModel: boolean,
  clearModel: () => void,
  showError: (error: string) => void
) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState<ClaudeCodeAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const refreshingRef = useRef(new Set<string>());
  const addingRef = useRef(false);
  const loginGeneration = useRef(0);
  const [login, setLogin] = useState<api.ClaudeCodeLogin | null>(null);
  const loginRef = useRef<api.ClaudeCodeLogin | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const cancelLogin = useCallback(() => {
    const pending = loginRef.current;
    loginGeneration.current += 1;
    loginRef.current = null;
    setLogin(null);
    setBusy(false);
    setLoginError(null);
    addingRef.current = false;
    submittingRef.current = null;
    setSubmitting(false);
    if (pending)
      void api.cancelClaudeCodeLogin(pending.loginId).catch((error) => showError(String(error)));
  }, [showError]);

  useEffect(() => {
    if (!login) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil(login.expiresAt - Date.now() / 1000));
      setRemainingSeconds(seconds);
      if (!seconds) cancelLogin();
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [login, cancelLogin]);

  useEffect(
    () => () => {
      loginGeneration.current += 1;
      const pending = loginRef.current;
      if (pending) void api.cancelClaudeCodeLogin(pending.loginId).catch(() => {});
      loginRef.current = null;
    },
    []
  );

  const reload = useCallback(async () => {
    const result = await api.listClaudeCodeAccounts();
    setAccounts(result);
    return result;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let ignore = false;
    void api
      .listClaudeCodeAccounts()
      .then((result) => {
        if (ignore) return;
        setAccounts(result);
        if (!hasModel) {
          setSelectedId((id) =>
            result.some((account) => account.id === id)
              ? id
              : (result.find((account) => account.active)?.id ?? null)
          );
        }
      })
      .catch((error) => {
        if (!ignore) showError(String(error));
      });
    return () => {
      ignore = true;
    };
  }, [enabled, hasModel, showError]);

  const select = (id: string) => {
    setSelectedId(id);
    clearModel();
  };

  const refresh = async (account: ClaudeCodeAccount, quiet = false) => {
    if (refreshingRef.current.has(account.id)) return;
    refreshingRef.current.add(account.id);
    setRefreshing(new Set(refreshingRef.current));
    try {
      const updated = await api.refreshClaudeCodeAccountQuota(account.id);
      setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      if (!quiet) showError(String(error));
    } finally {
      refreshingRef.current.delete(account.id);
      setRefreshing(new Set(refreshingRef.current));
    }
  };

  const add = async () => {
    if (addingRef.current) return;
    addingRef.current = true;
    const generation = ++loginGeneration.current;
    setBusy(true);
    setLoginError(null);
    try {
      const pending = await api.startClaudeCodeLogin();
      if (generation !== loginGeneration.current) {
        await api.cancelClaudeCodeLogin(pending.loginId);
        return;
      }
      loginRef.current = pending;
      setRemainingSeconds(Math.max(0, Math.ceil(pending.expiresAt - Date.now() / 1000)));
      setLogin(pending);
      await shellOpen(pending.authorizationUrl);
    } catch (error) {
      if (generation === loginGeneration.current) {
        cancelLogin();
        showError(String(error));
      }
    }
  };

  const completeLogin = async (code: string) => {
    const pending = loginRef.current;
    if (!pending || submittingRef.current === pending.loginId) return;
    submittingRef.current = pending.loginId;
    setSubmitting(true);
    setLoginError(null);
    try {
      const account = await api.completeClaudeCodeLogin(pending.loginId, code.trim());
      if (loginRef.current?.loginId !== pending.loginId) return;
      loginRef.current = null;
      setLogin(null);
      setBusy(false);
      addingRef.current = false;
      select(account.id);
      await reload().catch((error) => showError(String(error)));
      void refresh(account, true);
    } catch (error) {
      if (loginRef.current?.loginId === pending.loginId) setLoginError(String(error));
    } finally {
      if (submittingRef.current === pending.loginId) {
        submittingRef.current = null;
        setSubmitting(false);
      }
    }
  };

  const remove = async (account: ClaudeCodeAccount) => {
    if (
      !(await confirm({
        title: t('agent.deleteAccountTitle'),
        message: t('agent.deleteAccountConfirm').replace('{email}', account.email),
        confirmText: t('btn.delete'),
        type: 'danger',
      }))
    )
      return;
    try {
      await api.deleteClaudeCodeAccount(account.id);
      setSelectedId((id) => (id === account.id ? null : id));
      await reload();
    } catch (error) {
      showError(String(error));
    }
  };

  return {
    login,
    remainingSeconds,
    submitting,
    loginError,
    cancelLogin,
    completeLogin,
    accounts,
    selectedId,
    setSelectedId,
    select,
    busy,
    refreshing,
    add,
    refresh,
    remove,
    reload,
  };
}
