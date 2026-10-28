import { useEffect, useRef, useState } from 'react';
import { Copy, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { emit, listen } from '@tauri-apps/api/event';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import {
  closeSelectionTranslation,
  getSelectionTranslation,
  openSelectionTranslation,
  askSelection,
  readySelectionTranslation,
  translateSelection,
  type SelectionTranslation as Translation,
} from '../../api/voiceInput';
import { useI18n } from '../../hooks/useI18n';
import type { TKey } from '../../i18n';
import { copyText } from '../../utils/copyText';
import {
  THEME_CHANGED_EVENT,
  THEME_REQUEST_EVENT,
  useThemeStore,
  type ThemeSelection,
} from '../../stores/themeStore';
import './VoiceInput.css';

export function SelectionTranslation() {
  const { t } = useI18n();
  const [result, setResult] = useState<Translation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const revision = useRef(-1);
  const request = useRef(0);
  const lifetime = useRef({ active: true });
  useEffect(() => {
    const alive = lifetime.current;
    alive.active = true;
    let disposed = false;
    let stop: (() => void) | undefined;
    const accept = (value: Translation) => {
      if (disposed || value.revision < revision.current) return;
      if (!value.language) {
        request.current++;
        setPending(false);
      }
      revision.current = value.revision;
      setResult(value);
      setError(null);
      setCopied(false);
    };
    void listen<Translation>('voice-selection-state', (event) => accept(event.payload))
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        stop = unlisten;
        void getSelectionTranslation()
          .then(accept)
          .catch(() => {
            if (!disposed) setError('voice.selectionFailed');
          });
      })
      .catch(() => {
        if (!disposed) setError('voice.selectionFailed');
      });
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void closeSelectionTranslation();
    };
    window.addEventListener('keydown', escape);
    return () => {
      disposed = true;
      alive.active = false;
      stop?.();
      window.removeEventListener('keydown', escape);
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<ThemeSelection>(THEME_CHANGED_EVENT, (event) =>
      useThemeStore.getState().sync(event.payload)
    )
      .then((unlisten) => {
        if (disposed) unlisten();
        else {
          stop = unlisten;
          void emit(THEME_REQUEST_EVENT, {}).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  const shownRevision = result?.revision;
  useEffect(() => {
    if (shownRevision == null) return;
    const frame = requestAnimationFrame(() => {
      void readySelectionTranslation();
    });
    return () => cancelAnimationFrame(frame);
  }, [shownRevision]);
  const run = async (source: string, language: string) => {
    const current = ++request.current;
    setPending(true);
    setError(null);
    try {
      await translateSelection(source, language);
    } catch (failed) {
      if (lifetime.current.active && current === request.current) setError(String(failed));
    } finally {
      if (lifetime.current.active && current === request.current) setPending(false);
    }
  };
  const busy = Boolean(result?.busy || pending);
  const message =
    error ||
    result?.error ||
    (!busy && result && result.mode !== 'manual' && !result.source ? 'voice.selectionEmpty' : null);
  if (result?.mode === 'closed') return null;
  if (result?.mode === 'toolbar')
    return (
      <section className="voice-selection-toolbar" role="toolbar" aria-label={t('voice.selection')}>
        <div className="voice-island-actions">
          <img
            className="voice-selection-logo"
            src="/brand/bird.png"
            alt="EchoBird"
            draggable={false}
          />
          <button
            type="button"
            className="voice-island-translate"
            disabled={pending}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const current = ++request.current;
              setPending(true);
              void openSelectionTranslation()
                .catch((failed) => {
                  if (lifetime.current.active && current === request.current)
                    setError(String(failed));
                })
                .finally(() => {
                  if (lifetime.current.active && current === request.current) setPending(false);
                });
            }}
          >
            {pending ? (
              <LoaderCircle size={14} className="motion-safe:animate-spin" />
            ) : (
              t('voice.selectionAction')
            )}
          </button>
          <button
            type="button"
            className="voice-island-translate"
            disabled={pending}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const current = ++request.current;
              setPending(true);
              void askSelection()
                .catch((failed) => {
                  if (lifetime.current.active && current === request.current)
                    setError(String(failed));
                })
                .finally(() => {
                  if (lifetime.current.active && current === request.current) setPending(false);
                });
            }}
          >
            {t('voice.selectionAsk')}
          </button>
        </div>
      </section>
    );
  return (
    <section
      className="voice-translation-card"
      key={result?.source || 'manual'}
      aria-label={t('voice.selection')}
    >
      <header>
        <span className="voice-translation-title">{t('voice.selectionSource')}</span>
        <button
          type="button"
          className="voice-translation-icon"
          aria-label={t('voice.selectionClose')}
          onClick={() => void closeSelectionTranslation()}
        >
          <X size={17} />
        </button>
      </header>
      <div className="voice-translation-source">
        {result?.source || t('voice.selectionPasteHint')}
      </div>
      <div className="voice-translation-output" role="status" aria-live="polite">
        {busy ? (
          <span className="voice-translation-loading">
            <LoaderCircle size={17} className="motion-safe:animate-spin" />
            {t('voice.selectionWorking')}
          </span>
        ) : (
          result?.text
        )}
        {message && (
          <p className="voice-error" role="alert">
            {message.startsWith('voice.') ? t(message as TKey) : message}
          </p>
        )}
      </div>
      <footer>
        {!result?.source ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const current = ++request.current;
              void readText()
                .then((text) => {
                  if (lifetime.current.active && current === request.current)
                    return run(text, result?.language || 'zh-Hans');
                })
                .catch(() => {
                  if (lifetime.current.active && current === request.current)
                    setError('voice.selectionClipboard');
                });
            }}
          >
            {t('voice.selectionPaste')}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(result.source, result.language)}
          >
            <RefreshCw size={13} />
            {t('voice.selectionRetry')}
          </button>
        )}
        <button
          type="button"
          disabled={!result?.text || busy}
          onClick={() => {
            const current = revision.current;
            if (result?.text)
              void copyText(result.text).then((success) => {
                if (!lifetime.current.active || current !== revision.current) return;
                setCopied(success);
                if (!success) setError('voice.error.copy');
              });
          }}
        >
          <Copy size={13} />
          {t(copied ? 'voice.copied' : 'voice.copy')}
        </button>
      </footer>
    </section>
  );
}
