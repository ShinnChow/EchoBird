import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { getVoiceReplay } from '../../api/voiceInput';
import { useI18n } from '../../hooks/useI18n';

export function VoiceReplay({
  audioId,
  disabled,
  active,
  onError,
}: {
  audioId: number;
  disabled: boolean;
  active: boolean;
  onError: (failed: boolean) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing'>('idle');
  const request = useRef(0);
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const dispose = useCallback(() => {
    request.current++;
    if (source.current) {
      source.current.onended = null;
      source.current.stop();
      source.current.disconnect();
      source.current = null;
    }
    if (context.current) void context.current.close().catch(() => {});
    context.current = null;
  }, []);
  const stop = useCallback(() => {
    dispose();
    setStatus('idle');
  }, [dispose]);
  useEffect(() => dispose, [dispose]);
  const play = async () => {
    if (disabled || !active) return;
    if (status !== 'idle') return stop();
    const attempt = ++request.current;
    onError(false);
    setStatus('loading');
    try {
      const playback = new AudioContext();
      context.current = playback;
      await playback.resume();
      if (attempt !== request.current) return;
      const bytes = await getVoiceReplay(audioId);
      if (attempt !== request.current) return;
      const buffer = await playback.decodeAudioData(bytes);
      if (attempt !== request.current) return;
      const node = playback.createBufferSource();
      node.buffer = buffer;
      node.connect(playback.destination);
      node.onended = () => {
        if (attempt === request.current) stop();
      };
      node.start();
      source.current = node;
      setStatus('playing');
    } catch {
      if (attempt === request.current) {
        stop();
        onError(true);
      }
    }
  };
  return (
    <button
      type="button"
      className="voice-text-button"
      disabled={disabled || !active}
      aria-pressed={status !== 'idle'}
      aria-busy={status === 'loading'}
      onClick={() => void play()}
    >
      {status === 'idle' ? <Play size={14} /> : <Square size={14} />}
      {t(status === 'idle' ? 'voice.replay' : 'voice.stopReplay')}
    </button>
  );
}
