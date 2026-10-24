import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function VoiceAppIcon({ src, loading }: { src: string; loading: boolean }) {
  const current = useRef(src);
  const [settled, setSettled] = useState(src);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(loading);
  const [request, setRequest] = useState({ src, loading });
  if (request.src !== src || request.loading !== loading) {
    setRequest({ src, loading });
    if (loading || src !== settled) setSpinning(true);
  }
  const turning = spinning || loading || src !== settled;

  useLayoutEffect(() => {
    current.current = src;
  }, [src]);

  useEffect(() => {
    if (!turning) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      if (preference.matches && !loading && loaded === src) {
        setSettled(src);
        setSpinning(false);
      }
    };
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, [turning, loading, loaded, src]);

  return (
    <span
      className="voice-island-control voice-island-app"
      aria-hidden="true"
      data-spinning={turning}
    >
      <img
        src={src}
        alt=""
        onLoad={() => {
          if (current.current === src) setLoaded(src);
        }}
        onError={(event) => {
          if (current.current !== src) return;
          if (event.currentTarget.src.endsWith('/brand/bird.png')) setLoaded(src);
          else event.currentTarget.src = '/brand/bird.png';
        }}
        onAnimationIteration={() => {
          if (current.current === src && !loading && loaded === src) {
            setSettled(src);
            setSpinning(false);
          }
        }}
      />
    </span>
  );
}
