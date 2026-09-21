import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReminderDto } from '@calendar/shared';
import { api } from './api.ts';
import { fresh, pending, pruneDismissed, reminderKey } from './calendar/reminders.ts';
import { loadStringSet, saveStringSet } from './storage.ts';

const POLL_MS = 30_000;

interface Options {
  userId: string;
  /** Cambia cuando cambian los eventos: se vuelve a consultar de inmediato. */
  refreshKey: number;
  /** Avisos que aparecen por primera vez en esta sesión (para mostrar un aviso emergente). */
  onFresh: (reminders: ReminderDto[]) => void;
}

/**
 * Consulta periódicamente los recordatorios activos. Descartarlos es cosa del navegador: la
 * lista de descartados se guarda en localStorage y se limpia sola cuando el aviso caduca.
 */
export function useReminders({ userId, refreshKey, onFresh }: Options) {
  const storageKey = `dismissedReminders:${userId}`;
  const [active, setActive] = useState<ReminderDto[]>([]);
  const [dismissed, setDismissed] = useState(() => loadStringSet(storageKey));
  const [now, setNow] = useState(() => new Date());

  // Las últimas versiones, para que el intervalo no se reprograme en cada render.
  const dismissedRef = useRef(dismissed);
  const onFreshRef = useRef(onFresh);
  const announced = useRef(new Set<string>());
  useEffect(() => {
    dismissedRef.current = dismissed;
    onFreshRef.current = onFresh;
  });

  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      api
        .activeReminders()
        .then((list) => {
          if (cancelled) return;
          setActive(list);
          setNow(new Date());

          const kept = pruneDismissed(dismissedRef.current, list);
          if (kept.size !== dismissedRef.current.size) {
            setDismissed(kept);
            saveStringSet(storageKey, kept);
          }

          const news = fresh(pending(list, kept), announced.current);
          for (const reminder of news) announced.current.add(reminderKey(reminder));
          if (news.length > 0) onFreshRef.current(news);
        })
        .catch(() => {
          // Sin conexión o sesión caducada (lo gestiona el cliente de la API): reintentará.
        });
    };

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [storageKey, refreshKey]);

  const persist = useCallback(
    (next: Set<string>) => {
      setDismissed(next);
      saveStringSet(storageKey, next);
    },
    [storageKey],
  );

  const dismiss = useCallback(
    (reminder: ReminderDto) => persist(new Set(dismissed).add(reminderKey(reminder))),
    [dismissed, persist],
  );
  const dismissAll = useCallback(
    () => persist(new Set([...dismissed, ...active.map(reminderKey)])),
    [active, dismissed, persist],
  );

  return { reminders: pending(active, dismissed), now, dismiss, dismissAll };
}
