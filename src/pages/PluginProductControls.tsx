import { useEffect, useState } from 'react';
import type { InstalledPlugin } from '../api/plugins';
import { usePluginProductStore } from '../stores/pluginProductStore';
import { useI18n } from '../hooks/useI18n';
import { RoutingToggle } from '../components/RoutingToggle';

export function PluginProductControls({ plugin }: { plugin: InstalledPlugin }) {
  const { t } = useI18n();
  const sdk = usePluginProductStore();
  const [input, setInput] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const c = plugin.manifest.echobird.contributes;
  const has = !!(
    c.themes?.length ||
    c.commands?.length ||
    c.configuration?.length ||
    c.textProcessors?.length
  );
  useEffect(() => {
    if (has && plugin.enabled) void usePluginProductStore.getState().load();
  }, [has, plugin.id, plugin.enabled]);
  if (!has || !plugin.enabled) return null;
  const manage = (action: string, key: string, value: unknown = null) =>
    void sdk.manage(plugin.id, action, key, value).catch(() => {});
  return (
    <div className="ph-product-controls">
      {!!c.themes?.length && (
        <>
          <h3>{t('plugins.themes')}</h3>
          {c.themes.map((theme) => {
            const selected =
              sdk.snapshot.theme?.pluginId === plugin.id && sdk.snapshot.theme.id === theme.id;
            return (
              <button
                key={theme.id}
                className="ph-secondary"
                aria-pressed={selected}
                disabled={sdk.busy}
                onClick={() =>
                  void sdk.manage(selected ? null : plugin.id, 'theme', theme.id).catch(() => {})
                }
              >
                {theme.title} · {t(selected ? 'plugins.themeReset' : 'plugins.themeApply')}
              </button>
            );
          })}
        </>
      )}
      {!!c.configuration?.length && (
        <>
          <h3>{t('plugins.configuration')}</h3>
          {c.configuration.map((field) => {
            const value = sdk.snapshot.configuration[plugin.id]?.[field.key] ?? field.default;
            if (field.type === 'boolean')
              return (
                <RoutingToggle
                  key={field.key}
                  label={field.title}
                  checked={value === true}
                  pending={sdk.busy}
                  onChange={(checked) => manage('configuration', field.key, checked)}
                />
              );
            return (
              <label className="ph-field" key={field.key}>
                {field.title}
                {field.options?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {field.options.map((option, index) => (
                      <button
                        className="ph-secondary"
                        key={index}
                        aria-pressed={value === option}
                        disabled={sdk.busy}
                        onClick={() => manage('configuration', field.key, option)}
                      >
                        {String(option)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    key={JSON.stringify(value)}
                    aria-label={field.title}
                    type={field.type === 'number' ? 'number' : 'text'}
                    defaultValue={String(value)}
                    disabled={sdk.busy}
                    onBlur={(event) => {
                      const next =
                        field.type === 'number' ? Number(event.target.value) : event.target.value;
                      if (next !== value) manage('configuration', field.key, next);
                    }}
                  />
                )}
              </label>
            );
          })}
        </>
      )}
      {!!c.textProcessors?.length && (
        <>
          <h3>{t('plugins.textProcessors')}</h3>
          {c.textProcessors.map((processor) => (
            <RoutingToggle
              key={processor.id}
              label={processor.title}
              checked={sdk.snapshot.processors.some(
                (p) => p.pluginId === plugin.id && p.id === processor.id
              )}
              pending={sdk.busy}
              onChange={(checked) => manage('processor', processor.id, checked)}
            />
          ))}
        </>
      )}
      {!!c.commands?.length && (
        <>
          <h3>{t('plugins.commands')}</h3>
          <label className="ph-field">
            {t('plugins.commandInput')}
            <textarea value={input} onChange={(event) => setInput(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            {c.commands.map((command) => (
              <button
                key={command.id}
                className="ph-secondary"
                disabled={sdk.busy}
                onClick={() =>
                  void sdk
                    .execute(plugin.id, command.id, { text: input })
                    .then((value) =>
                      setResult(
                        typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
                      )
                    )
                    .catch(() => {})
                }
              >
                {command.title}
              </button>
            ))}
          </div>
          {result !== null && <pre className="ph-product-result">{result}</pre>}
        </>
      )}
      {(sdk.error || sdk.snapshot.errors[plugin.id]) && (
        <p role="alert" className="ph-error">
          {sdk.error ?? sdk.snapshot.errors[plugin.id]}
        </p>
      )}
    </div>
  );
}
