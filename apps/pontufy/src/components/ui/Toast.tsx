'use client';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type ToastPriority = 'low' | 'normal' | 'high';

interface Toast {
  id: number;
  title: string;
  description?: string;
  priority: ToastPriority;
  actionLabel?: string;
  onAction?: () => void;
  undo?: () => void;
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id' | 'priority'> & { priority?: ToastPriority }) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Sistema Toast/Snackbar MD3 — fila prioritária (high sobrepõe), ação Undo e
// autoclose 6s. Snackbar tonal (inverse-surface escura) com elevação 3dp.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, 'id' | 'priority'> & { priority?: ToastPriority }) => {
      const id = nextId.current++;
      const entry: Toast = { ...t, id, priority: t.priority ?? 'normal' };
      setToasts((prev) => {
        const hasHigher = prev.some((p) => p.priority === 'high');
        return hasHigher && entry.priority !== 'high' ? prev : [...prev, entry];
      });
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 6000),
      );
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[120] flex flex-col items-center gap-2 w-full max-w-sm px-4"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              role="status"
              className={`w-full flex items-start gap-3 px-4 py-3 rounded-2xl bg-md-surface-container-high text-md-on-surface shadow-2xl border border-md-outline ${
                t.priority === 'high' ? 'border-md-highlight/40' : ''
              }`}
            >
              <span className="mt-0.5 flex-shrink-0">
                {t.priority === 'high' ? (
                  <AlertTriangle size={18} className="text-md-highlight" />
                ) : t.priority === 'low' ? (
                  <Info size={18} className="text-md-on-surface-variant" />
                ) : (
                  <CheckCircle2 size={18} className="text-md-tertiary" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-md-on-surface">{t.title}</p>
                {t.description && <p className="text-xs text-md-on-surface-variant mt-0.5">{t.description}</p>}
                <div className="flex items-center gap-4 mt-2">
                  {t.undo && (
                    <button
                      type="button"
                      onClick={() => {
                        t.undo?.();
                        dismiss(t.id);
                      }}
                      className="text-xs font-bold text-md-tertiary hover:text-md-tertiary/80 transition-colors"
                    >
                      Desfazer
                    </button>
                  )}
                  {t.actionLabel && t.onAction && (
                    <button
                      type="button"
                      onClick={() => {
                        t.onAction?.();
                        dismiss(t.id);
                      }}
                      className="text-xs font-bold text-md-secondary hover:text-md-secondary/80 transition-colors"
                    >
                      {t.actionLabel}
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Fechar notificação"
                className="p-1 text-md-on-surface-variant hover:text-md-on-surface transition-colors flex-shrink-0"
              >
                <X size={16} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de <ToastProvider>');
  return ctx;
}