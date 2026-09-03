import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

const controlBase =
  'w-full border border-input rounded px-3 text-sm bg-card text-foreground font-sans ' +
  'placeholder:text-muted-fg focus:outline-none focus:border-primary ' +
  'focus:ring-[3px] focus:ring-accent-subtle disabled:opacity-50 disabled:cursor-not-allowed';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={[controlBase, 'h-9', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 3, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={[controlBase, 'py-2 leading-normal', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
});

export interface FieldProps {
  label: ReactNode;
  htmlFor: string;
  required?: boolean;
  help?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  required = false,
  help,
  error,
  children,
  className,
}: FieldProps) {
  const helpId = help ? `${htmlFor}-help` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className={['flex flex-col gap-1 mb-3.5', className].filter(Boolean).join(' ')}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium">
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {help && !error && (
        <p id={helpId} className="text-xs text-muted-fg">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
