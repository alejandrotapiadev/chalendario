// iCalendar (RFC 5545): serialización y lectura del subconjunto que entiende la aplicación.
// Módulo puro (sin I/O): recibe y devuelve texto y datos.
//
// Lo que se conserva: título, descripción, ubicación, estado, fechas (con zona horaria y
// «todo el día»), repetición diaria/semanal/mensual, avisos (VALARM) y categoría.
// Lo que no: excepciones de series (EXDATE, RECURRENCE-ID), reglas RRULE complejas, invitados
// y adjuntos. Al leer, lo no soportado se avisa en `warnings` en vez de fallar en silencio.

import type { EventFields, NewEventInput } from './event.ts';
import { RECURRENCE_LIMITS, weekdayIn, type RecurrenceRule } from './recurrence.ts';
import { isValidTimezone, wallClock, zonedTimeToInstant } from './timezone.ts';

export class IcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcsError';
  }
}

const CRLF = '\r\n';
const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

// ---------------------------------------------------------------------------------------
// Serialización
// ---------------------------------------------------------------------------------------

export interface IcsExportEvent {
  /** Identificador estable del evento; los clientes lo usan para reconocerlo entre descargas. */
  uid: string;
  /** Número de modificación (versión − 1). */
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
  fields: EventFields;
  /** Minutos de antelación de los avisos. */
  reminders: number[];
  categoryName: string | null;
}

const encoder = new TextEncoder();

/** Pliega una línea a 75 octetos (RFC 5545 §3.1) sin partir caracteres multibyte. */
function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // las continuaciones empiezan con un espacio
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

export function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function unescapeText(text: string): string {
  return text.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

const formatUtc = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

function formatDate(d: Date, timeZone: string): string {
  const w = wallClock(d, timeZone);
  return `${pad(w.year, 4)}${pad(w.month)}${pad(w.day)}`;
}

function formatLocal(d: Date, timeZone: string): string {
  const w = wallClock(d, timeZone);
  return `${formatDate(d, timeZone)}T${pad(w.hour)}${pad(w.minute)}${pad(w.second)}`;
}

function formatRule(rule: RecurrenceRule, fields: EventFields): string {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === 'weekly' && rule.byWeekday?.length) {
    parts.push(`BYDAY=${rule.byWeekday.map((d) => DAY_CODES[d]).join(',')}`);
  }
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) {
    // `until` es una fecha local inclusiva; en un evento con hora, RFC pide un instante UTC.
    const [y, m, d] = rule.until.split('-').map(Number) as [number, number, number];
    parts.push(
      `UNTIL=${
        fields.allDay
          ? rule.until.replaceAll('-', '')
          : formatUtc(zonedTimeToInstant(y, m, d, 23, 59, 59, fields.timezone))
      }`,
    );
  }
  return parts.join(';');
}

function eventLines(event: IcsExportEvent, now: Date): string[] {
  const f = event.fields;
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${formatUtc(now)}`,
    `CREATED:${formatUtc(event.createdAt)}`,
    `LAST-MODIFIED:${formatUtc(event.updatedAt)}`,
    `SEQUENCE:${event.sequence}`,
    `SUMMARY:${escapeText(f.title)}`,
  ];
  if (f.description) lines.push(`DESCRIPTION:${escapeText(f.description)}`);
  if (f.location) lines.push(`LOCATION:${escapeText(f.location)}`);
  lines.push(`STATUS:${f.status.toUpperCase()}`);
  if (event.categoryName) lines.push(`CATEGORIES:${escapeText(event.categoryName)}`);

  if (f.allDay) {
    // DTEND de un evento de todo el día es exclusivo, igual que `endAt` en nuestro modelo.
    lines.push(`DTSTART;VALUE=DATE:${formatDate(f.startAt, f.timezone)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDate(f.endAt, f.timezone)}`);
  } else if (f.recurrence) {
    // Con repetición hace falta la zona: «a las 10:00» debe seguir siéndolo tras un cambio de hora.
    lines.push(`DTSTART;TZID=${f.timezone}:${formatLocal(f.startAt, f.timezone)}`);
    lines.push(`DTEND;TZID=${f.timezone}:${formatLocal(f.endAt, f.timezone)}`);
  } else {
    lines.push(`DTSTART:${formatUtc(f.startAt)}`, `DTEND:${formatUtc(f.endAt)}`);
  }
  if (f.recurrence) lines.push(`RRULE:${formatRule(f.recurrence, f)}`);

  for (const minutes of event.reminders) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(f.title)}`,
      `TRIGGER:${minutes === 0 ? 'PT0S' : `-PT${minutes}M`}`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

/** Genera un fichero `.ics` (con saltos de línea CRLF y líneas plegadas). */
export function serializeIcs(options: {
  name: string;
  events: IcsExportEvent[];
  now: Date;
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Personal Calendar//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.name)}`,
    ...options.events.flatMap((event) => eventLines(event, options.now)),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------------------

export interface ParsedIcsEvent {
  /** UID del fichero, o null si no lo traía. */
  uid: string | null;
  fields: NewEventInput;
  reminders: number[];
  categoryName: string | null;
}

export interface IcsParseResult {
  events: ParsedIcsEvent[];
  /** Cosas que se importaron con pérdida (repetición no soportada, zona desconocida…). */
  warnings: string[];
  /** Eventos que no se pudieron leer. */
  skipped: { title: string; reason: string }[];
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Separa `NOMBRE;PARAM=valor;PARAM="con:dos puntos":valor`. */
function parseContentLine(line: string): Prop | null {
  let i = 0;
  while (i < line.length && line[i] !== ':' && line[i] !== ';') i++;
  const name = line.slice(0, i).toUpperCase();
  const params: Record<string, string> = {};
  while (line[i] === ';') {
    i++;
    let start = i;
    while (i < line.length && line[i] !== '=' && line[i] !== ':' && line[i] !== ';') i++;
    const key = line.slice(start, i).toUpperCase();
    let value = '';
    if (line[i] === '=') {
      i++;
      if (line[i] === '"') {
        start = ++i;
        while (i < line.length && line[i] !== '"') i++;
        value = line.slice(start, i);
        i++;
      } else {
        start = i;
        while (i < line.length && line[i] !== ';' && line[i] !== ':') i++;
        value = line.slice(start, i);
      }
    }
    params[key] = value;
  }
  return line[i] === ':' ? { name, params, value: line.slice(i + 1) } : null;
}

/** Nombres de zona de Windows (Outlook) más habituales. */
const WINDOWS_ZONES: Record<string, string> = {
  'Romance Standard Time': 'Europe/Paris',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'SA Pacific Standard Time': 'America/Bogota',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'China Standard Time': 'Asia/Shanghai',
  'India Standard Time': 'Asia/Kolkata',
  UTC: 'UTC',
};

interface Resolved {
  timeZone: string;
  /** No se reconoció el nombre y se usó la zona por defecto. */
  fallback: boolean;
}

function resolveTzid(raw: string, fallbackZone: string): Resolved {
  const candidates = [raw, WINDOWS_ZONES[raw] ?? ''];
  // Nombres con prefijo, p. ej. `/mozilla.org/20050126_1/Europe/Madrid`.
  const segments = raw.split('/').filter(Boolean);
  if (segments.length > 1) {
    candidates.push(segments.slice(-2).join('/'), segments.slice(-1)[0]!);
  }
  const found = candidates.find((c) => c !== '' && isValidTimezone(c));
  return found ? { timeZone: found, fallback: false } : { timeZone: fallbackZone, fallback: true };
}

interface DateValue {
  date: { year: number; month: number; day: number };
  time: { hour: number; minute: number; second: number } | null;
  utc: boolean;
  /** Zona indicada por TZID (ya resuelta), o null si es UTC, flotante o solo fecha. */
  timeZone: string | null;
}

function parseDateValue(
  prop: Prop,
  fallbackZone: string,
  warn: (m: string) => void,
): DateValue | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(prop.value.trim());
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (match[4] === undefined) return { date, time: null, utc: false, timeZone: null };

  const utc = match[7] === 'Z';
  let timeZone: string | null = null;
  const tzid = prop.params['TZID'];
  if (!utc && tzid) {
    const resolved = resolveTzid(tzid, fallbackZone);
    timeZone = resolved.timeZone;
    if (resolved.fallback) warn(`Zona horaria desconocida «${tzid}»: se usó ${fallbackZone}.`);
  }
  return {
    date,
    time: { hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6]) },
    utc,
    timeZone,
  };
}

function instantOf(value: DateValue, zone: string): Date {
  const { year, month, day } = value.date;
  const { hour, minute, second } = value.time ?? { hour: 0, minute: 0, second: 0 };
  return value.utc
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    : zonedTimeToInstant(year, month, day, hour, minute, second, zone);
}

/** Duración ISO 8601 (`P1D`, `PT1H30M`, `-PT15M`, `P1W`) en milisegundos; null si no es válida. */
function parseDuration(text: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    text.trim(),
  );
  if (!m || text.trim().replace(/^[+-]?P/, '') === '') return null;
  const [w, d, h, min, s] = [m[2], m[3], m[4], m[5], m[6]].map((v) => Number(v ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const ms = w * 7 * DAY_MS + d * DAY_MS + h * HOUR_MS + min * MINUTE_MS + s * 1000;
  return m[1] === '-' ? -ms : ms;
}

const civilDate = (d: DateValue['date']) => `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;

interface RuleResult {
  rule: RecurrenceRule | null;
  /** Por qué no se pudo convertir (la serie se importa sin repetición). */
  unsupported: string | null;
}

function parseRule(
  value: string,
  start: { weekday: number; day: number; zone: string },
  fallbackZone: string,
): RuleResult {
  const parts = new Map<string, string>();
  for (const piece of value.split(';')) {
    const [k, ...rest] = piece.split('=');
    if (k) parts.set(k.toUpperCase(), rest.join('='));
  }
  const unsupported = (why: string): RuleResult => ({ rule: null, unsupported: why });

  const freqText = parts.get('FREQ')?.toUpperCase();
  const freq = ({ DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' } as const)[
    freqText as 'DAILY' | 'WEEKLY' | 'MONTHLY'
  ];
  if (!freq) return unsupported(`FREQ=${freqText ?? '?'}`);

  const known = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'UNTIL', 'COUNT', 'WKST']);
  for (const key of parts.keys()) if (!known.has(key)) return unsupported(key);

  const interval = Number(parts.get('INTERVAL') ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > RECURRENCE_LIMITS.intervalMax) {
    return unsupported(`INTERVAL=${parts.get('INTERVAL')}`);
  }
  const rule: RecurrenceRule = { freq, interval };

  const byDay = parts.get('BYDAY');
  if (byDay !== undefined) {
    if (freq !== 'weekly') return unsupported('BYDAY fuera de una regla semanal');
    const days: number[] = [];
    for (const token of byDay.split(',')) {
      const t = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(token.trim().toUpperCase());
      if (!t || t[1]) return unsupported(`BYDAY=${byDay}`);
      days.push(DAY_CODES.indexOf(t[2]!));
    }
    // El inicio del evento siempre es la primera ocurrencia, como en la mayoría de clientes.
    rule.byWeekday = [...new Set([...days, start.weekday])].sort((a, b) => a - b);
  }

  const byMonthDay = parts.get('BYMONTHDAY');
  if (byMonthDay !== undefined && (freq !== 'monthly' || Number(byMonthDay) !== start.day)) {
    return unsupported(`BYMONTHDAY=${byMonthDay}`);
  }

  const untilText = parts.get('UNTIL');
  const countText = parts.get('COUNT');
  if (untilText !== undefined) {
    const until = parseDateValue(
      { name: 'UNTIL', params: {}, value: untilText },
      fallbackZone,
      () => {},
    );
    if (!until) return unsupported(`UNTIL=${untilText}`);
    // Un UNTIL en UTC se convierte a la fecha local de la zona del evento.
    const local =
      until.utc && until.time ? wallClock(instantOf(until, 'UTC'), start.zone) : until.date;
    rule.until = civilDate({ year: local.year, month: local.month, day: local.day });
  } else if (countText !== undefined) {
    const count = Number(countText);
    if (!Number.isInteger(count) || count < 1 || count > RECURRENCE_LIMITS.countMax) {
      return unsupported(`COUNT=${countText}`);
    }
    rule.count = count;
  }
  return { rule, unsupported: null };
}

/** Lee `TRIGGER` como «minutos antes del inicio», o null si no se puede representar. */
function parseTrigger(props: Prop[]): { minutes: number | null; reason?: string } {
  const trigger = props.find((p) => p.name === 'TRIGGER');
  if (!trigger) return { minutes: null, reason: 'aviso sin TRIGGER' };
  if (trigger.params['VALUE']?.toUpperCase() === 'DATE-TIME') {
    return { minutes: null, reason: 'aviso con hora absoluta' };
  }
  if (trigger.params['RELATED']?.toUpperCase() === 'END') {
    return { minutes: null, reason: 'aviso relativo al fin' };
  }
  const ms = parseDuration(trigger.value);
  if (ms === null) return { minutes: null, reason: `TRIGGER ${trigger.value}` };
  if (ms > 0) return { minutes: null, reason: 'aviso posterior al inicio' };
  const minutes = Math.round(-ms / MINUTE_MS);
  return minutes <= 40_320 ? { minutes } : { minutes: null, reason: 'aviso con más de 4 semanas' };
}

const STATUSES = {
  CONFIRMED: 'confirmed',
  TENTATIVE: 'tentative',
  CANCELLED: 'cancelled',
} as const;

/**
 * Lee un `.ics`. `defaultTimezone` se usa para horas «flotantes» (sin zona) y para los eventos
 * de todo el día. Lanza `IcsError` si el texto no es un calendario.
 */
export function parseIcs(text: string, defaultTimezone: string): IcsParseResult {
  // Los ficheros de Windows suelen empezar por un BOM UTF-8.
  const body = text.replace(/^\uFEFF/, '');
  if (!/^BEGIN:VCALENDAR/im.test(body)) {
    throw new IcsError('No es un fichero iCalendar (.ics) válido');
  }

  const lines = body
    .replace(/\r?\n[ \t]/g, '') // desplegar líneas
    .split(/\r?\n/);

  const result: IcsParseResult = { events: [], warnings: [], skipped: [] };
  const seen = new Set<string>();
  const warn = (message: string) => {
    if (!seen.has(message)) {
      seen.add(message);
      result.warnings.push(message);
    }
  };

  const stack: string[] = [];
  let props: Prop[] | null = null;
  let alarms: Prop[][] = [];
  let alarm: Prop[] | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const prop = parseContentLine(line);
    if (!prop) continue;

    if (prop.name === 'BEGIN') {
      const component = prop.value.toUpperCase();
      stack.push(component);
      if (component === 'VEVENT') [props, alarms] = [[], []];
      else if (component === 'VALARM' && props) alarm = [];
    } else if (prop.name === 'END') {
      const component = stack.pop();
      if (component === 'VALARM' && alarm) {
        alarms.push(alarm);
        alarm = null;
      } else if (component === 'VEVENT' && props) {
        readEvent(props, alarms, defaultTimezone, result, warn);
        props = null;
      }
    } else if (alarm) alarm.push(prop);
    else if (props && stack.at(-1) === 'VEVENT') props.push(prop);
  }
  return result;
}

function readEvent(
  props: Prop[],
  alarms: Prop[][],
  defaultTimezone: string,
  result: IcsParseResult,
  warn: (message: string) => void,
): void {
  const get = (name: string) => props.find((p) => p.name === name);
  const title = unescapeText(get('SUMMARY')?.value ?? '').trim() || '(sin título)';
  const skip = (reason: string): void => {
    result.skipped.push({ title, reason });
  };

  if (get('RECURRENCE-ID')) return skip('modificación de una sola ocurrencia (no soportada)');
  const dtstart = get('DTSTART');
  if (!dtstart) return skip('sin fecha de inicio');
  const start = parseDateValue(dtstart, defaultTimezone, warn);
  if (!start) return skip(`fecha de inicio no válida (${dtstart.value})`);

  const allDay = start.time === null;
  const ruleProp = get('RRULE');

  // Zona del evento: la de TZID; una hora en UTC con repetición sigue siendo UTC (sin ajustar
  // al horario de verano, como en el original); en el resto, la zona por defecto.
  let timezone = defaultTimezone;
  if (!allDay) {
    if (start.timeZone) timezone = start.timeZone;
    else if (start.utc && ruleProp) timezone = 'UTC';
  }

  const startAt = instantOf(start, timezone);
  let endAt: Date;
  const dtend = get('DTEND');
  const duration = get('DURATION');
  if (dtend) {
    const end = parseDateValue(dtend, defaultTimezone, warn);
    if (!end) return skip(`fecha de fin no válida (${dtend.value})`);
    endAt = instantOf(end, end.timeZone ?? timezone);
  } else if (duration) {
    const ms = parseDuration(duration.value);
    if (ms === null) return skip(`DURATION no válida (${duration.value})`);
    if (allDay) {
      const days = Math.max(1, Math.round(ms / DAY_MS));
      const d = new Date(Date.UTC(start.date.year, start.date.month - 1, start.date.day + days));
      endAt = zonedTimeToInstant(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        0,
        0,
        0,
        timezone,
      );
    } else {
      endAt = new Date(startAt.getTime() + ms);
    }
  } else {
    endAt = new Date(startAt.getTime() + (allDay ? 0 : HOUR_MS));
  }
  if (endAt <= startAt) {
    // Sin fin (o de duración cero): un día si es de todo el día, una hora si no.
    if (allDay) {
      const d = new Date(Date.UTC(start.date.year, start.date.month - 1, start.date.day + 1));
      endAt = zonedTimeToInstant(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        0,
        0,
        0,
        timezone,
      );
    } else {
      endAt = new Date(startAt.getTime() + HOUR_MS);
    }
  }

  let recurrence: RecurrenceRule | null = null;
  if (ruleProp) {
    const parsed = parseRule(
      ruleProp.value,
      {
        weekday: weekdayIn(startAt, timezone),
        day: wallClock(startAt, timezone).day,
        zone: timezone,
      },
      timezone,
    );
    recurrence = parsed.rule;
    if (parsed.unsupported) {
      warn(
        `«${title}»: repetición no soportada (${parsed.unsupported}); se importó solo la primera ocurrencia.`,
      );
    }
  }
  if (get('EXDATE')) {
    warn(
      `«${title}»: las ocurrencias excluidas (EXDATE) no se conservan y aparecerán en el calendario.`,
    );
  }
  if (get('RDATE')) warn(`«${title}»: las fechas adicionales (RDATE) no se importan.`);

  const reminders: number[] = [];
  for (const a of alarms) {
    const { minutes, reason } = parseTrigger(a);
    if (minutes === null) warn(`«${title}»: aviso omitido (${reason}).`);
    else reminders.push(minutes);
  }

  const status =
    STATUSES[(get('STATUS')?.value.trim().toUpperCase() ?? '') as keyof typeof STATUSES];
  const category = get('CATEGORIES')?.value.split(/(?<!\\),/)[0];

  result.events.push({
    uid: get('UID')?.value.trim() || null,
    fields: {
      title,
      description: unescapeText(get('DESCRIPTION')?.value ?? ''),
      location: unescapeText(get('LOCATION')?.value ?? ''),
      startAt,
      endAt,
      timezone,
      allDay,
      status: status ?? 'confirmed',
      recurrence,
    },
    reminders: [...new Set(reminders)].sort((a, b) => a - b),
    categoryName: category ? unescapeText(category).trim() || null : null,
  });
}
