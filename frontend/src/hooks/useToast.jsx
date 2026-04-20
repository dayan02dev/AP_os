// Minimal toast bus — React context + pub/sub. No CSS-framework assumptions;
// renders a top-right stack using existing styles.css hooks.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const ToastContext = createContext(null);

let _seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    ({ kind = "info", message, ttlMs = 4500 } = {}) => {
      const id = ++_seq;
      setToasts((prev) => [...prev, { id, kind, message }]);
      if (ttlMs > 0) {
        const timer = setTimeout(() => dismiss(id), ttlMs);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      // Cleanup pending timers on unmount.
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toasts, push, dismiss }}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="eir-toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`eir-toast eir-toast-${t.kind}`}>
          <span className="eir-toast-msg">{t.message}</span>
          <button
            className="eir-toast-x eir-mono"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback: no provider mounted (e.g. tests). Return a console-backed API.
    return {
      toasts: [],
      push: ({ message } = {}) => {
        // eslint-disable-next-line no-console
        console.info("[toast]", message);
        return 0;
      },
      dismiss: () => {},
    };
  }
  return ctx;
}
