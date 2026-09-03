export interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  // Bounds are clamped on each press. Default 0..99 — 0 means "not ordered".
  min?: number;
  max?: number;
  disabled?: boolean;
  // Accessible labels for the − / + controls (item-specific, supplied by the caller).
  decreaseLabel: string;
  increaseLabel: string;
  size?: 'sm' | 'lg';
}

// A bounded −/+ counter for picking how many portions of one menu item to order. Holds no state:
// the parent owns the value and clamps live here so it can never drift out of [min, max].
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  disabled = false,
  decreaseLabel,
  increaseLabel,
  size = 'sm',
}: QuantityStepperProps) {
  const btn =
    size === 'lg'
      ? 'h-11 w-11 text-xl'
      : 'h-8 w-8 text-base';
  const box = size === 'lg' ? 'w-10 text-lg' : 'w-8 text-base';

  const set = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={decreaseLabel}
        onClick={() => set(value - 1)}
        disabled={disabled || value <= min}
        className={`${btn} rounded-md border-2 border-border bg-card font-bold leading-none disabled:opacity-40 hover:bg-muted transition-colors`}
      >
        −
      </button>
      <span className={`${box} text-center tabular-nums font-semibold`} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label={increaseLabel}
        onClick={() => set(value + 1)}
        disabled={disabled || value >= max}
        className={`${btn} rounded-md border-2 border-border bg-card font-bold leading-none disabled:opacity-40 hover:bg-muted transition-colors`}
      >
        +
      </button>
    </div>
  );
}
