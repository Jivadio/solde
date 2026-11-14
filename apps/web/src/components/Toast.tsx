// SPDX-License-Identifier: AGPL-3.0-or-later
// A short confirmation after an action that closed its dialog. The live
// region is always in the page, so screen readers announce each message.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';

const TOAST_MS = 4000;

type Show = (message: string) => void;

const ToastContext = createContext<Show>(() => {});

/** Shows a toast: `const toast = useToast(); toast(t('…'))`. */
export function useToast(): Show {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(
    null,
  );
  const show = useCallback<Show>((message) => {
    setToast({ id: Date.now(), message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="sd-toast-region" role="status" aria-live="polite">
        {toast && (
          <p key={toast.id} className="sd-toast label">
            <Icon name="check" size={18} />
            {toast.message}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
}
