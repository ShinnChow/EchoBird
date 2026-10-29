interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
  pending?: boolean;
  className?: string;
}

export function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
  pending = false,
  className = '',
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-cyber-accent ${checked ? 'bg-cyber-accent' : 'bg-cyber-border'} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-[2px] top-[2px] h-[16px] w-[16px] rounded-full bg-[rgb(var(--switch-thumb-rgb))] transition-transform duration-200 ${checked ? 'translate-x-[16px]' : 'translate-x-0'}`}
      />
    </button>
  );
}
