import { useTranslation } from 'react-i18next';
import { Button } from '@/ui';

export interface PrisonIdKeypadProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;

/**
 * Large-touch numeric keypad for canteen ID entry.
 * Digits append to value; backspace removes the last char; clear resets to ''.
 * Submit fires with the current value (trimmed).
 */
export function PrisonIdKeypad({
  value,
  onChange,
  onSubmit,
  disabled = false,
}: PrisonIdKeypadProps) {
  const { t } = useTranslation('canteen');

  function append(digit: string) {
    onChange(value + digit);
  }

  function backspace() {
    onChange(value.slice(0, -1));
  }

  function clear() {
    onChange('');
  }

  function handleSubmit() {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-xs mx-auto">
      {/* ID display */}
      <div
        aria-live="polite"
        aria-label={t('enterPrisonId')}
        className="w-full min-h-[3.5rem] flex items-center justify-center rounded-lg border-2 border-border bg-card text-3xl font-mono font-bold tracking-widest px-4 py-2 text-foreground select-none"
      >
        {value || <span className="text-muted-fg text-lg font-normal">{t('enterPrisonIdHint')}</span>}
      </div>

      {/* Digit grid: 3-column layout — rows 1-9 then 0 centered */}
      <div
        role="group"
        aria-label={t('enterPrisonId')}
        className="grid grid-cols-3 gap-3 w-full"
      >
        {DIGITS.slice(0, 9).map((d) => (
          <Button
            key={d}
            variant="outline"
            size="lg"
            aria-label={t('keypadDigit', { digit: d })}
            disabled={disabled}
            onClick={() => append(d)}
            className="h-16 text-2xl font-semibold"
          >
            {d}
          </Button>
        ))}

        {/* Bottom row: clear | 0 | backspace */}
        <Button
          variant="outline"
          size="lg"
          aria-label={t('keypadClear')}
          disabled={disabled}
          onClick={clear}
          className="h-16 text-base font-semibold"
        >
          C
        </Button>

        <Button
          variant="outline"
          size="lg"
          aria-label={t('keypadDigit', { digit: '0' })}
          disabled={disabled}
          onClick={() => append('0')}
          className="h-16 text-2xl font-semibold"
        >
          0
        </Button>

        <Button
          variant="outline"
          size="lg"
          aria-label={t('keypadBackspace')}
          disabled={disabled}
          onClick={backspace}
          className="h-16 text-2xl font-semibold"
        >
          ⌫
        </Button>
      </div>

      {/* Submit */}
      <Button
        variant="primary"
        size="lg"
        aria-label={t('keypadSubmit')}
        disabled={disabled || !value.trim()}
        onClick={handleSubmit}
        className="w-full h-16 text-xl font-bold"
      >
        {t('keypadSubmit')}
      </Button>
    </div>
  );
}
