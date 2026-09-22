const pad = (n: number) => String(n).padStart(2, '0');

/** Formato `YYYY-MM-DD` en hora local, igual que `toDateInput` en la web. */
export function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
