import { useEffect, useRef, useState } from 'react';
import { Gift } from 'lucide-react';
import { attachHoloCard } from '@kongyo2/cards-css';
import '@kongyo2/cards-css/styles.css';
import { useI18n } from '../../hooks/useI18n';
import { usePetsStore } from '../../stores/petsStore';
import { HASTE_DURATION, rewardCountdown, type PetReward, type RewardKind } from './petRewardRules';

function PixelSymbol({ kind }: { kind: RewardKind }) {
  const paths = {
    growth: 'M6 1h4v2h2v3h2v5h-2v3h-2v2H6v-2H4v-3H2V6h2V3h2z',
    double: 'M2 4h5V2l5 4-5 4V8H2zm12 8H9v-2l-5 4 5 4v-2h5z',
    haste: 'M8 1h6v2h-2v2h-2v2H8v2h4v2h-2v2H8v2H6v2H4v-6H2V9h2V7h2V5h2z',
  };
  return (
    <svg viewBox="0 0 16 20" aria-hidden="true" shapeRendering="crispEdges">
      <path d={paths[kind]} fill="currentColor" />
      {kind === 'growth' && <path d="M6 4h2v8H6zm2-1h2v3H8z" fill="#d8ffe8" />}
    </svg>
  );
}

export default function PetRewardDialog({
  reward,
  onClose,
}: {
  reward: PetReward;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const spin = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'sealed' | 'settling' | 'opening' | 'revealed'>(
    reward.opened === false ? 'sealed' : 'revealed'
  );
  const [showFront, setShowFront] = useState(reward.opened !== false);
  const sealed = phase === 'sealed';
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    if (phase === 'settling') {
      const timer = setTimeout(() => setPhase('opening'), 20);
      return () => clearTimeout(timer);
    }
    if (phase !== 'opening') return;
    const midpoint = setTimeout(() => {
      setShowFront(true);
      usePetsStore.getState().revealReward();
    }, 46);
    const finish = setTimeout(() => setPhase('revealed'), 100);
    return () => {
      clearTimeout(midpoint);
      clearTimeout(finish);
    };
  }, [phase]);
  useEffect(() => {
    if (!card.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const effect = attachHoloCard(card.current, {
      effect: !showFront
        ? 'metal'
        : reward.kind === 'growth'
          ? 'mosaic'
          : reward.kind === 'double'
            ? 'gold'
            : 'metal',
      palette: !showFront ? { preset: 'mono' } : undefined,
      gyroscope: false,
      interactive: phase === 'revealed' && !reduced,
      showcase: false,
      physics: { maxTilt: 10, returnDelay: 100 },
      visual: { shineOpacity: 0.6, glareOpacity: 0.35 },
      depth: { strength: 4 },
    });
    return () => effect.destroy();
  }, [reward.kind, phase, showFront]);
  const amount = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(reward.amount);
  const reveal = () => {
    if (!sealed) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      usePetsStore.getState().revealReward();
      setShowFront(true);
      setPhase('revealed');
    } else {
      spin.current!.style.setProperty(
        '--pet-card-stop',
        window.getComputedStyle(spin.current!).transform
      );
      setPhase('settling');
    }
  };

  return (
    <dialog
      ref={dialog}
      className="pet-reward-dialog"
      aria-label={t('pets.reward.title')}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="pet-reward-reveal"
        role={sealed ? 'button' : undefined}
        tabIndex={sealed ? 0 : undefined}
        aria-label={sealed ? t('pets.reward.open') : undefined}
        onClick={reveal}
        onKeyDown={(event) => {
          if (sealed && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            reveal();
          }
        }}
      >
        <div
          className="pet-reward-perspective"
          data-kind={showFront ? reward.kind : 'sealed'}
          data-phase={phase}
        >
          <div className="pet-reward-spin" ref={spin}>
            <div className="holo-card pet-reward-holo" ref={card}>
              <div className="holo-card__translater">
                <div className="holo-card__rotator">
                  <div className="holo-card__front">
                    <div className="holo-card__content">
                      <div className="pet-reward-face">
                        {showFront ? (
                          <>
                            <small>ECHO BIRD · {reward.kind.toUpperCase()}</small>
                            <PixelSymbol kind={reward.kind} />
                            <h4>{t(`pets.reward.${reward.kind}`)}</h4>
                            <strong>
                              {reward.kind === 'growth'
                                ? `+${amount}`
                                : reward.kind === 'double'
                                  ? '×2'
                                  : `−${rewardCountdown(HASTE_DURATION, 0)}`}
                            </strong>
                            <p>{t(`pets.reward.${reward.kind}Detail`)}</p>
                          </>
                        ) : (
                          <Gift aria-hidden="true" strokeWidth={1} />
                        )}
                      </div>
                    </div>
                    <div className="holo-card__shine" />
                    <div className="holo-card__glare" />
                  </div>
                  {!showFront && (
                    <div className="holo-card__back pet-reward-back" aria-hidden="true">
                      <Gift strokeWidth={1} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="pet-reward-actions">
        {phase === 'revealed' && (
          <button
            type="button"
            className="pets-upgrade pet-reward-use"
            onClick={() => {
              if (usePetsStore.getState().useReward()) onClose();
            }}
            autoFocus
          >
            {t('pets.reward.use')}
          </button>
        )}
      </div>
    </dialog>
  );
}
