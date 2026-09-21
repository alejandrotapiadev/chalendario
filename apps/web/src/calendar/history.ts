import type { FieldChange, FieldValue, TrackedField } from '@calendar/domain';
import type { EventDto } from '@calendar/shared';
import { LOCALE } from './dates.ts';
import { describeRule } from './recurrence.ts';

export const STATUS_LABELS: Record<EventDto['status'], string> = {
  confirmed: 'Confirmado',
  tentative: 'Provisional',
  cancelled: 'Cancelado',
};

const FIELD_LABELS: Record<Exclude<TrackedField, 'deleted'>, string> = {
  title: 'Título',
  description: 'Descripción',
  startAt: 'Inicio',
  endAt: 'Fin',
  timezone: 'Zona horaria',
  allDay: 'Todo el día',
  location: 'Ubicación',
  status: 'Estado',
  color: 'Color',
  categoryId: 'Categoría',
  recurrence: 'Repetición',
};

/** Datos de otras partes de la app que hacen falta para escribir algunos cambios. */
export interface DescribeContext {
  /** Nombre de una categoría a partir de su id. */
  categoryName?: (id: string) => string | undefined;
}

const dateTime = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const MAX_TEXT = 60;

function formatValue(field: TrackedField, value: FieldValue, ctx: DescribeContext): string {
  if (field === 'recurrence') {
    return value !== null && typeof value === 'object' ? describeRule(value) : 'no se repite';
  }
  if (value === null || value === '') return field === 'categoryId' ? 'ninguna' : 'vacío';
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  if (typeof value !== 'string') return 'vacío';
  if (field === 'startAt' || field === 'endAt') return dateTime.format(new Date(value));
  if (field === 'status') return STATUS_LABELS[value as EventDto['status']] ?? value;
  if (field === 'color') return value;
  if (field === 'categoryId') return `«${ctx.categoryName?.(value) ?? 'categoría desconocida'}»`;
  const text = value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  return `«${text}»`;
}

/** Frase legible de un cambio: «Inicio: 21 sept, 10:00 → 21 sept, 11:00». */
export function describeChange(change: FieldChange, ctx: DescribeContext = {}): string {
  if (change.field === 'deleted') {
    return change.to === true ? 'Evento eliminado' : 'Evento restaurado';
  }
  const label = FIELD_LABELS[change.field];
  return `${label}: ${formatValue(change.field, change.from, ctx)} → ${formatValue(change.field, change.to, ctx)}`;
}

/** Motivo del cambio en español; `null` si no aporta nada al usuario. */
export function describeReason(reason: string | null): string | null {
  if (reason === null || reason === 'deleted') return null; // el borrado ya sale en los cambios
  const restored = /^restored from version (\d+)$/.exec(reason);
  return restored ? `Restaurada desde la versión ${restored[1]}` : reason;
}
