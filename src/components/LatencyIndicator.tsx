import { useEffect, useId, useRef, useState } from 'react';
import { useDocumentVisible } from '../hooks/useDocumentVisible';
import { useI18n } from '../hooks/useI18n';
import { latencyThreadDuration, latencyThreads } from '../utils/threadWave';

export function LatencyIndicator() {
  const { t } = useI18n();
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const visible = useDocumentVisible();
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!visible || reducedMotion) return;
    // Start after the SVG timeline has been registered by the browser.
    const frame = requestAnimationFrame(() => {
      svgRef.current?.querySelectorAll('animate').forEach((animation) => animation.beginElement());
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, reducedMotion]);

  return (
    <span className="model-latency-loading" role="status">
      <span className="sr-only">{t('mother.testing')}</span>
      <svg
        ref={svgRef}
        className="model-latency-threads"
        viewBox="0 0 72 16"
        fill="none"
        stroke={`url(#${gradientId})`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId}>
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="15%" stopColor="currentColor" stopOpacity="0.65" />
            <stop offset="50%" stopColor="currentColor" />
            <stop offset="85%" stopColor="currentColor" stopOpacity="0.65" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {latencyThreads.map((thread, index) => (
          <path
            key={index}
            d={thread.path}
            strokeWidth={index === 3 ? 0.9 : 0.55}
            opacity={index === 3 ? 1 : 0.28 + index * 0.055}
            strokeLinecap="round"
          >
            {visible && !reducedMotion && (
              <animate
                attributeName="d"
                values={thread.frames}
                dur={`${latencyThreadDuration}s`}
                begin="indefinite"
                repeatCount="indefinite"
              />
            )}
          </path>
        ))}
      </svg>
    </span>
  );
}
