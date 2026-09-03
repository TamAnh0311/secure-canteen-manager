import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type ToastTone = 'success' | 'danger' | 'info' | 'warning';

export interface ToastOptions {
  tone: ToastTone;
  message: string;
  title?: string;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4000;

const toneClasses: Record<ToastTone, string> = {
  success: 'bg-success-bg text-success-fg',
  danger: 'bg-danger-bg text-danger-fg',
  info: 'bg-info-bg text-info-fg',
  warning: 'bg-warning-bg text-warning-fg',
};

export interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [items, setItems] = useState<ToastEntry[]>([]);
  const seq = useRef(0);
  const { t } = useTranslation('common');

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = ++seq.current;
      setItems((prev) => [...prev, { ...opts, id }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[320px] max-w-[calc(100vw-2rem)]"
        >
          {items.map((item) => (
            <div
              key={item.id}
              className={[
                'flex items-start gap-2.5 px-3.5 py-2.5 rounded text-[13px] shadow-lg',
                toneClasses[item.tone],
              ].join(' ')}
            >
              <div className="flex-1">
                {item.title && <div className="font-semibold">{item.title}</div>}
                <div>{item.message}</div>
              </div>
              <button
                type="button"
                aria-label={t('dismiss')}
                onClick={() => dismiss(item.id)}
                className="shrink-0 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded"
              >
                ✕
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
