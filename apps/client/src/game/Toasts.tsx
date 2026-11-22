import { Toast } from '../ui';
import styles from './Toasts.module.css';
import { useGame, useStore } from './store';
import { useEffect } from 'react';

const SHOW_MS = 7000;

/** The stack of messages in the corner. Each fades after a while. */
export function Toasts() {
  const store = useStore();
  const toasts = useGame((s) => s.toasts);
  useEffect(() => {
    const timers = toasts.map((t) =>
      setTimeout(() => {
        store.dispatch({ type: 'dismiss', id: t.id });
      }, SHOW_MS),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [toasts, store]);
  return (
    <div className={styles['stack']} aria-live="polite">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          tone={t.tone}
          title={t.title}
          onDismiss={() => {
            store.dispatch({ type: 'dismiss', id: t.id });
          }}
        >
          {t.text}
        </Toast>
      ))}
    </div>
  );
}
