import * as RadixSelect from '@radix-ui/react-select';

export interface SelectItem {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  items: SelectItem[];
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

const triggerClass =
  'inline-flex items-center justify-between w-full h-9 px-3 text-sm bg-card text-foreground ' +
  'border border-input rounded font-sans gap-2 data-[placeholder]:text-muted-fg ' +
  'focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-accent-subtle ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export function Select({
  value,
  onValueChange,
  items,
  placeholder = 'Select…',
  id,
  ariaLabel,
  disabled,
  className,
}: SelectProps) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={[triggerClass, className].filter(Boolean).join(' ')}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon aria-hidden="true" className="text-muted-fg">
          ▾
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] bg-card border border-border rounded shadow-lg overflow-hidden"
        >
          <RadixSelect.Viewport className="p-1">
            {items.map((item) => (
              <RadixSelect.Item
                key={item.value}
                value={item.value}
                className="relative flex items-center h-8 pl-7 pr-3 text-sm rounded select-none cursor-pointer outline-none data-[highlighted]:bg-accent-subtle data-[state=checked]:font-medium"
              >
                <RadixSelect.ItemIndicator className="absolute left-2 inline-flex text-primary">
                  ✓
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{item.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
