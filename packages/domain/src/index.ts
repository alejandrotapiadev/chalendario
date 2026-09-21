// Lógica de dominio pura (sin I/O): eventos, versionado y recurrencia.
// Ver docs/data-model.md.
export * from './event.ts';
export { isValidTimezone, isLocalMidnight, wallClock } from './timezone.ts';
