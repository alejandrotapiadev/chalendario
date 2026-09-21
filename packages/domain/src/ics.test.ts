import { describe, expect, it } from 'vitest';
import { newEventFields, type EventFields } from './event.ts';
import { IcsError, escapeText, parseIcs, serializeIcs, type IcsExportEvent } from './ics.ts';
import { zonedTimeToInstant } from './timezone.ts';

const TZ = 'Europe/Madrid';
const madrid = (y: number, m: number, d: number, h = 0, mi = 0) =>
  zonedTimeToInstant(y, m, d, h, mi, 0, TZ);
const NOW = new Date('2026-09-21T12:00:00Z');

const fields = (over: Partial<EventFields> = {}): EventFields =>
  newEventFields({
    title: 'Gym',
    startAt: madrid(2026, 9, 21, 10),
    endAt: madrid(2026, 9, 21, 11),
    timezone: TZ,
    ...over,
  });

const exportEvent = (over: Partial<IcsExportEvent> = {}): IcsExportEvent => ({
  uid: 'evt-1@personal-calendar',
  sequence: 0,
  createdAt: new Date('2026-09-01T08:00:00Z'),
  updatedAt: new Date('2026-09-02T08:00:00Z'),
  fields: fields(),
  reminders: [],
  categoryName: null,
  ...over,
});

const ics = (events: IcsExportEvent[], name = 'Personal') =>
  serializeIcs({ name, events, now: NOW });

/** Envuelve líneas en un VCALENDAR con saltos CRLF. */
const calendar = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');
const vevent = (...lines: string[]) =>
  ['BEGIN:VEVENT', 'UID:u1', ...lines, 'END:VEVENT'].join('\r\n');

describe('serializeIcs', () => {
  it('genera un calendario con CRLF, cabecera y un evento con hora en UTC', () => {
    const text = ics([exportEvent()]);
    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).not.toMatch(/[^\r]\n/); // ningún salto de línea sin CR
    expect(text).toContain('X-WR-CALNAME:Personal\r\n');
    expect(text).toContain('UID:evt-1@personal-calendar\r\n');
    expect(text).toContain('DTSTART:20260921T080000Z\r\n');
    expect(text).toContain('DTEND:20260921T090000Z\r\n');
    expect(text).toContain('SUMMARY:Gym\r\n');
    expect(text).toContain('STATUS:CONFIRMED\r\n');
    expect(text).toContain('DTSTAMP:20260921T120000Z\r\n');
    expect(text).toContain('SEQUENCE:0\r\n');
  });

  it('escapa comas, punto y coma, barras y saltos de línea', () => {
    expect(escapeText('a, b; c \\ d\ne')).toBe('a\\, b\\; c \\\\ d\\ne');
    const text = ics([
      exportEvent({
        fields: fields({ title: 'Cena, con; amigos', description: 'línea 1\nlínea 2' }),
      }),
    ]);
    expect(text).toContain('SUMMARY:Cena\\, con\\; amigos\r\n');
    expect(text).toContain('DESCRIPTION:línea 1\\nlínea 2\r\n');
  });

  it('pliega las líneas largas a 75 octetos sin partir caracteres multibyte', () => {
    const long = 'ñandú 🦩 '.repeat(40);
    const text = ics([exportEvent({ fields: fields({ description: long }) })]);
    for (const physical of text.split('\r\n')) {
      expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(75);
    }
    const back = parseIcs(text, TZ);
    expect(back.events[0]!.fields.description).toBe(long);
  });

  it('un evento de todo el día usa fechas (VALUE=DATE) con fin exclusivo', () => {
    const allDay = fields({
      title: 'Vacaciones',
      allDay: true,
      startAt: madrid(2026, 9, 24),
      endAt: madrid(2026, 9, 27),
    });
    const text = ics([exportEvent({ fields: allDay })]);
    expect(text).toContain('DTSTART;VALUE=DATE:20260924\r\n');
    expect(text).toContain('DTEND;VALUE=DATE:20260927\r\n');
  });

  it('una serie usa TZID y RRULE para conservar la hora local', () => {
    const series = fields({
      recurrence: { freq: 'weekly', interval: 2, byWeekday: [0, 2], count: 4 },
    });
    const text = ics([exportEvent({ fields: series })]);
    expect(text).toContain('DTSTART;TZID=Europe/Madrid:20260921T100000\r\n');
    expect(text).toContain('DTEND;TZID=Europe/Madrid:20260921T110000\r\n');
    expect(text).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4\r\n');
  });

  it('UNTIL: instante UTC del final del día local en eventos con hora, fecha en los de todo el día', () => {
    const timed = fields({ recurrence: { freq: 'daily', interval: 1, until: '2026-10-02' } });
    // 23:59:59 del 2 oct en Madrid (CEST) = 21:59:59Z
    expect(ics([exportEvent({ fields: timed })])).toContain(
      'RRULE:FREQ=DAILY;UNTIL=20261002T215959Z\r\n',
    );
    const allDay = fields({
      allDay: true,
      startAt: madrid(2026, 9, 21),
      endAt: madrid(2026, 9, 22),
      recurrence: { freq: 'daily', interval: 1, until: '2026-10-02' },
    });
    expect(ics([exportEvent({ fields: allDay })])).toContain('RRULE:FREQ=DAILY;UNTIL=20261002\r\n');
  });

  it('incluye avisos, categoría, estado y secuencia', () => {
    const text = ics([
      exportEvent({
        fields: fields({ status: 'tentative' }),
        reminders: [0, 10, 1440],
        categoryName: 'Salud',
        sequence: 3,
      }),
    ]);
    expect(text).toContain('STATUS:TENTATIVE\r\n');
    expect(text).toContain('CATEGORIES:Salud\r\n');
    expect(text).toContain('SEQUENCE:3\r\n');
    expect(text).toContain('TRIGGER:PT0S\r\n');
    expect(text).toContain('TRIGGER:-PT10M\r\n');
    expect(text).toContain('TRIGGER:-PT1440M\r\n');
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(3);
  });

  it('omite descripción y ubicación vacías', () => {
    const text = ics([exportEvent()]);
    expect(text).not.toContain('DESCRIPTION');
    expect(text).not.toContain('LOCATION');
  });
});

describe('parseIcs: formatos de fecha', () => {
  it('lee un evento de todo el día de Google (fecha, fin exclusivo, UID y estado)', () => {
    const { events } = parseIcs(
      calendar(
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20240106',
        'DTEND;VALUE=DATE:20240107',
        'UID:20240106_peppaur3bnsa51ejiljd5bp1s0@google.com',
        'DESCRIPTION:Día festivo',
        'STATUS:CONFIRMED',
        'SUMMARY:Epifanía del Señor',
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      ),
      TZ,
    );
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.uid).toBe('20240106_peppaur3bnsa51ejiljd5bp1s0@google.com');
    expect(e.fields).toMatchObject({
      title: 'Epifanía del Señor',
      description: 'Día festivo',
      allDay: true,
      timezone: TZ,
      status: 'confirmed',
    });
    expect(e.fields.startAt).toEqual(madrid(2024, 1, 6));
    expect(e.fields.endAt).toEqual(madrid(2024, 1, 7));
    // Y es válido para el dominio (medianoche local).
    expect(() => newEventFields(e.fields)).not.toThrow();
  });

  it('una hora en UTC es un instante absoluto y el evento usa la zona por defecto', () => {
    const { events } = parseIcs(
      calendar(vevent('DTSTART:20260921T080000Z', 'DTEND:20260921T090000Z', 'SUMMARY:X')),
      TZ,
    );
    expect(events[0]!.fields.startAt.toISOString()).toBe('2026-09-21T08:00:00.000Z');
    expect(events[0]!.fields.timezone).toBe(TZ);
  });

  it('TZID: interpreta la hora de pared en esa zona y la conserva como zona del evento', () => {
    const { events, warnings } = parseIcs(
      calendar(
        'BEGIN:VTIMEZONE',
        'TZID:America/New_York',
        'BEGIN:STANDARD',
        'DTSTART:19701101T020000',
        'END:STANDARD',
        'END:VTIMEZONE',
        vevent(
          'DTSTART;TZID=America/New_York:20260921T090000',
          'DTEND;TZID=America/New_York:20260921T100000',
          'SUMMARY:Llamada',
        ),
      ),
      TZ,
    );
    expect(events).toHaveLength(1); // el DTSTART del VTIMEZONE no cuenta como evento
    expect(events[0]!.fields.startAt.toISOString()).toBe('2026-09-21T13:00:00.000Z'); // EDT, UTC-4
    expect(events[0]!.fields.timezone).toBe('America/New_York');
    expect(warnings).toEqual([]);
  });

  it('una hora flotante (sin zona) usa la zona por defecto', () => {
    const { events } = parseIcs(
      calendar(vevent('DTSTART:20260921T100000', 'DTEND:20260921T110000', 'SUMMARY:X')),
      TZ,
    );
    expect(events[0]!.fields.startAt.toISOString()).toBe('2026-09-21T08:00:00.000Z');
  });

  it('nombres de zona de Windows y con prefijo se reconocen; los desconocidos avisan', () => {
    const { events, warnings } = parseIcs(
      calendar(
        vevent(
          'DTSTART;TZID=Romance Standard Time:20260921T100000',
          'DTEND;TZID=Romance Standard Time:20260921T110000',
          'SUMMARY:Outlook',
        ),
        vevent(
          'DTSTART;TZID=/mozilla.org/20050126_1/Europe/London:20260921T100000',
          'DTEND;TZID=/mozilla.org/20050126_1/Europe/London:20260921T110000',
          'SUMMARY:Mozilla',
        ),
        vevent(
          'DTSTART;TZID=Zona Inventada:20260921T100000',
          'DTEND;TZID=Zona Inventada:20260921T110000',
          'SUMMARY:Rara',
        ),
      ),
      TZ,
    );
    expect(events.map((e) => e.fields.timezone)).toEqual(['Europe/Paris', 'Europe/London', TZ]);
    expect(warnings).toEqual(['Zona horaria desconocida «Zona Inventada»: se usó Europe/Madrid.']);
  });

  it('los parámetros pueden ir entre comillas y contener dos puntos', () => {
    const { events } = parseIcs(
      calendar(
        vevent(
          'DTSTART;TZID="Europe/Madrid";X-FOO="a:b":20260921T100000',
          'DTEND;TZID=Europe/Madrid:20260921T110000',
          'SUMMARY:X',
        ),
      ),
      'UTC',
    );
    expect(events[0]!.fields.timezone).toBe(TZ);
  });
});

describe('parseIcs: duración y fin', () => {
  const parse = (...lines: string[]) => parseIcs(calendar(vevent(...lines)), TZ).events[0]!.fields;

  it('DURATION sustituye a DTEND', () => {
    const f = parse('DTSTART:20260921T080000Z', 'DURATION:PT1H30M', 'SUMMARY:X');
    expect(f.endAt.toISOString()).toBe('2026-09-21T09:30:00.000Z');
    const allDay = parse('DTSTART;VALUE=DATE:20260921', 'DURATION:P3D', 'SUMMARY:X');
    expect(allDay.endAt).toEqual(madrid(2026, 9, 24));
    expect(parse('DTSTART:20260921T080000Z', 'DURATION:P1W', 'SUMMARY:X').endAt.toISOString()).toBe(
      '2026-09-28T08:00:00.000Z',
    );
  });

  it('sin fin: una hora si tiene hora, un día si es de todo el día', () => {
    expect(parse('DTSTART:20260921T080000Z', 'SUMMARY:X').endAt.toISOString()).toBe(
      '2026-09-21T09:00:00.000Z',
    );
    expect(parse('DTSTART;VALUE=DATE:20260921', 'SUMMARY:X').endAt).toEqual(madrid(2026, 9, 22));
  });

  it('un fin igual o anterior al inicio se corrige', () => {
    expect(
      parse('DTSTART:20260921T080000Z', 'DTEND:20260921T080000Z', 'SUMMARY:X').endAt.toISOString(),
    ).toBe('2026-09-21T09:00:00.000Z');
  });
});

describe('parseIcs: repetición', () => {
  const parseRule = (rule: string, ...extra: string[]) =>
    parseIcs(
      calendar(
        vevent(
          'DTSTART;TZID=Europe/Madrid:20260921T100000',
          'DTEND;TZID=Europe/Madrid:20260921T110000',
          `RRULE:${rule}`,
          'SUMMARY:Serie',
          ...extra,
        ),
      ),
      TZ,
    );

  it('semanal con BYDAY, intervalo y COUNT', () => {
    const { events } = parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4');
    expect(events[0]!.fields.recurrence).toEqual({
      freq: 'weekly',
      interval: 2,
      byWeekday: [0, 2],
      count: 4,
    });
  });

  it('el día del inicio se añade a BYDAY si faltaba (el inicio es la primera ocurrencia)', () => {
    const { events } = parseRule('FREQ=WEEKLY;BYDAY=WE');
    expect(events[0]!.fields.recurrence?.byWeekday).toEqual([0, 2]); // el 21 sep 2026 es lunes
  });

  it('diaria y mensual; UNTIL en UTC se convierte a fecha local', () => {
    expect(parseRule('FREQ=DAILY;UNTIL=20261002T215959Z').events[0]!.fields.recurrence).toEqual({
      freq: 'daily',
      interval: 1,
      until: '2026-10-02',
    });
    expect(parseRule('FREQ=MONTHLY;BYMONTHDAY=21').events[0]!.fields.recurrence).toEqual({
      freq: 'monthly',
      interval: 1,
    });
    expect(parseRule('FREQ=DAILY;UNTIL=20261002').events[0]!.fields.recurrence?.until).toBe(
      '2026-10-02',
    );
  });

  it('una hora en UTC con repetición se queda en UTC (sin ajustes por horario de verano)', () => {
    const { events } = parseIcs(
      calendar(
        vevent(
          'DTSTART:20260921T080000Z',
          'DTEND:20260921T090000Z',
          'RRULE:FREQ=DAILY',
          'SUMMARY:X',
        ),
      ),
      TZ,
    );
    expect(events[0]!.fields.timezone).toBe('UTC');
  });

  it.each([
    ['FREQ=YEARLY', /FREQ=YEARLY/],
    ['FREQ=MONTHLY;BYDAY=2TU', /BYDAY/],
    ['FREQ=MONTHLY;BYDAY=MO', /BYDAY/],
    ['FREQ=WEEKLY;BYDAY=2MO', /BYDAY=2MO/],
    ['FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO', /BYSETPOS/],
    ['FREQ=DAILY;BYHOUR=9', /BYHOUR/],
    ['FREQ=MONTHLY;BYMONTHDAY=15', /BYMONTHDAY=15/],
    ['FREQ=DAILY;INTERVAL=200', /INTERVAL=200/],
    ['FREQ=DAILY;COUNT=5000', /COUNT=5000/],
  ])('%s no se soporta: se importa solo la primera ocurrencia y se avisa', (rule, reason) => {
    const { events, warnings } = parseRule(rule);
    expect(events).toHaveLength(1);
    expect(events[0]!.fields.recurrence).toBeNull();
    expect(warnings.join(' ')).toMatch(reason);
    expect(warnings.join(' ')).toContain('«Serie»');
  });

  it('EXDATE y RDATE avisan de que no se conservan', () => {
    const { warnings } = parseRule(
      'FREQ=DAILY',
      'EXDATE:20260922T080000Z',
      'RDATE:20260930T080000Z',
    );
    expect(warnings.join('\n')).toMatch(/EXDATE/);
    expect(warnings.join('\n')).toMatch(/RDATE/);
  });
});

describe('parseIcs: avisos, texto y metadatos', () => {
  const alarm = (...lines: string[]) => ['BEGIN:VALARM', 'ACTION:DISPLAY', ...lines, 'END:VALARM'];

  it('lee avisos relativos al inicio en minutos, horas y días', () => {
    const { events, warnings } = parseIcs(
      calendar(
        vevent(
          'DTSTART:20260921T080000Z',
          'SUMMARY:X',
          ...alarm('TRIGGER:-PT15M'),
          ...alarm('TRIGGER:-P1D'),
          ...alarm('TRIGGER:PT0S'),
          ...alarm('TRIGGER:-PT2H'),
          ...alarm('TRIGGER:-PT15M'), // repetido
        ),
      ),
      TZ,
    );
    expect(events[0]!.reminders).toEqual([0, 15, 120, 1440]);
    expect(warnings).toEqual([]);
  });

  it('avisa de los avisos que no se pueden representar', () => {
    const { events, warnings } = parseIcs(
      calendar(
        vevent(
          'DTSTART:20260921T080000Z',
          'SUMMARY:Aviso raro',
          ...alarm('TRIGGER;VALUE=DATE-TIME:20260921T070000Z'),
          ...alarm('TRIGGER;RELATED=END:-PT5M'),
          ...alarm('TRIGGER:PT30M'),
          ...alarm('TRIGGER:-P8W'),
        ),
      ),
      TZ,
    );
    expect(events[0]!.reminders).toEqual([]);
    expect(warnings).toHaveLength(4);
  });

  it('las propiedades de un VALARM no se mezclan con las del evento', () => {
    const { events } = parseIcs(
      calendar(
        vevent(
          'DTSTART:20260921T080000Z',
          'SUMMARY:Real',
          ...alarm('DESCRIPTION:Falso', 'TRIGGER:-PT5M'),
        ),
      ),
      TZ,
    );
    expect(events[0]!.fields.title).toBe('Real');
    expect(events[0]!.fields.description).toBe('');
  });

  it('desescapa texto, despliega líneas plegadas y acepta LF y BOM', () => {
    const text =
      '﻿BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:u9\nDTSTART:20260921T080000Z\nSUMMARY:Cena\\, con\\; amigos\nDESCRIPTION:linea 1\\nlinea\n  2 con\\\\barra\nLOCATION:Sala\\, 2\nEND:VEVENT\nEND:VCALENDAR\n';
    const f = parseIcs(text, TZ).events[0]!.fields;
    expect(f.title).toBe('Cena, con; amigos');
    expect(f.description).toBe('linea 1\nlinea 2 con\\barra');
    expect(f.location).toBe('Sala, 2');
  });

  it('lee estado y categoría (la primera)', () => {
    const { events } = parseIcs(
      calendar(
        vevent(
          'DTSTART:20260921T080000Z',
          'SUMMARY:X',
          'STATUS:TENTATIVE',
          'CATEGORIES:Salud,Trabajo',
        ),
      ),
      TZ,
    );
    expect(events[0]).toMatchObject({ categoryName: 'Salud' });
    expect(events[0]!.fields.status).toBe('tentative');
    const unknown = parseIcs(
      calendar(vevent('DTSTART:20260921T080000Z', 'SUMMARY:X', 'STATUS:LO-QUE-SEA')),
      TZ,
    );
    expect(unknown.events[0]!.fields.status).toBe('confirmed');
  });

  it('un evento sin UID devuelve uid null y sin título recibe uno por defecto', () => {
    const { events } = parseIcs(
      calendar('BEGIN:VEVENT', 'DTSTART:20260921T080000Z', 'END:VEVENT'),
      TZ,
    );
    expect(events[0]).toMatchObject({ uid: null });
    expect(events[0]!.fields.title).toBe('(sin título)');
  });
});

describe('parseIcs: lo que no se puede leer', () => {
  it('lanza IcsError si no es un calendario', () => {
    expect(() => parseIcs('hola mundo', TZ)).toThrow(IcsError);
    expect(() => parseIcs('', TZ)).toThrow(/iCalendar/);
  });

  it('omite con motivo los eventos sin inicio, con fecha inválida o que modifican una ocurrencia', () => {
    const { events, skipped } = parseIcs(
      calendar(
        'BEGIN:VEVENT',
        'SUMMARY:Sin inicio',
        'END:VEVENT',
        vevent('DTSTART:mañana', 'SUMMARY:Fecha mala'),
        vevent('DTSTART:20260921T080000Z', 'RECURRENCE-ID:20260921T080000Z', 'SUMMARY:Excepción'),
        vevent('DTSTART:20260921T080000Z', 'DTEND:cuando sea', 'SUMMARY:Fin malo'),
        vevent('DTSTART:20260921T080000Z', 'SUMMARY:Buena'),
      ),
      TZ,
    );
    expect(events.map((e) => e.fields.title)).toEqual(['Buena']);
    expect(skipped.map((s) => s.title)).toEqual([
      'Sin inicio',
      'Fecha mala',
      'Excepción',
      'Fin malo',
    ]);
    expect(skipped[2]!.reason).toMatch(/una sola ocurrencia/);
  });

  it('ignora componentes que no son eventos (tareas, notas de diario)', () => {
    const { events } = parseIcs(
      calendar('BEGIN:VTODO', 'DTSTART:20260921T080000Z', 'SUMMARY:Tarea', 'END:VTODO'),
      TZ,
    );
    expect(events).toEqual([]);
  });
});

describe('ciclo completo: serializar y volver a leer', () => {
  const cases: [string, EventFields][] = [
    [
      'con hora',
      fields({ title: 'Cena, con; amigos', location: 'Sala 2', description: 'Trae\nvino' }),
    ],
    [
      'de todo el día',
      fields({
        title: 'Vacaciones',
        allDay: true,
        startAt: madrid(2026, 9, 24),
        endAt: madrid(2026, 9, 27),
      }),
    ],
    [
      'semanal con días y COUNT',
      fields({ recurrence: { freq: 'weekly', interval: 2, byWeekday: [0, 2], count: 4 } }),
    ],
    [
      'diaria hasta una fecha',
      fields({ recurrence: { freq: 'daily', interval: 1, until: '2026-10-02' } }),
    ],
    [
      'mensual',
      fields({
        startAt: madrid(2026, 9, 15, 9),
        endAt: madrid(2026, 9, 15, 10),
        recurrence: { freq: 'monthly', interval: 3 },
      }),
    ],
    [
      'de todo el día y semanal',
      fields({
        allDay: true,
        startAt: madrid(2026, 10, 19),
        endAt: madrid(2026, 10, 21),
        recurrence: { freq: 'weekly', interval: 1, byWeekday: [0] },
      }),
    ],
    ['cancelado', fields({ status: 'cancelled' })],
    [
      'a las 00:30 (cruza el cambio de hora)',
      fields({
        startAt: madrid(2026, 10, 24, 23, 30),
        endAt: madrid(2026, 10, 25, 0, 30),
        recurrence: { freq: 'daily', interval: 1 },
      }),
    ],
  ];

  it.each(cases)('%s', (_name, original) => {
    const text = ics([
      exportEvent({ fields: original, reminders: [10, 60], categoryName: 'Salud' }),
    ]);
    const { events, warnings, skipped } = parseIcs(text, original.timezone);
    expect(warnings).toEqual([]);
    expect(skipped).toEqual([]);
    expect(events).toHaveLength(1);

    const back = events[0]!;
    expect(back.uid).toBe('evt-1@personal-calendar');
    expect(back.reminders).toEqual([10, 60]);
    expect(back.categoryName).toBe('Salud');

    // Al volver a validar con el dominio se obtiene el mismo contenido.
    const restored = newEventFields(back.fields);
    expect(restored).toEqual(original);
  });

  it('varios eventos', () => {
    const text = ics([
      exportEvent({ uid: 'a', fields: fields({ title: 'A' }) }),
      exportEvent({ uid: 'b', fields: fields({ title: 'B' }) }),
    ]);
    expect(parseIcs(text, TZ).events.map((e) => [e.uid, e.fields.title])).toEqual([
      ['a', 'A'],
      ['b', 'B'],
    ]);
  });
});
