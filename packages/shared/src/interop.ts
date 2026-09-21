import { z } from 'zod';
import { COLOR_PATTERN } from '@calendar/domain';
import type { CalendarDto } from './calendar.ts';

/** Tamaño máximo (caracteres) de un `.ics` importado. */
export const IMPORT_MAX_CHARS = 5_000_000;

export const importIcsSchema = z.strictObject({
  /** Contenido del fichero `.ics`. */
  ics: z.string().min(1).max(IMPORT_MAX_CHARS),
  /** Zona horaria para las horas «flotantes» y los eventos de todo el día del fichero. */
  timezone: z.string().min(1),
});
export type ImportIcsInput = z.infer<typeof importIcsSchema>;

/** Resultado de importar o sincronizar un `.ics`. */
export interface ImportResultDto {
  created: number;
  updated: number;
  unchanged: number;
  /** Eventos borrados por no estar ya en el origen (solo al sincronizar una URL). */
  removed: number;
  /** Eventos que no se pudieron leer, con el motivo. */
  skipped: { title: string; reason: string }[];
  /** Cosas que se importaron con pérdida. */
  warnings: string[];
}

export const subscribeSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(COLOR_PATTERN, 'debe tener el formato #rrggbb').optional(),
  /** URL `.ics` (o `webcal://`) del calendario a seguir. */
  url: z.string().trim().min(1).max(2000),
  timezone: z.string().min(1),
});
export type SubscribeInput = z.infer<typeof subscribeSchema>;

export interface SubscribeResultDto {
  calendar: CalendarDto;
  result: ImportResultDto;
}

export interface FeedStatusDto {
  enabled: boolean;
  createdAt: string | null;
}

/** Ruta del enlace de suscripción; el cliente le antepone su origen y `/api`. */
export interface FeedCreatedDto {
  path: string;
}
