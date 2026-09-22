// Preferencias por navegador (p. ej. calendarios ocultos). Puede fallar o estar vacío
// (modo privado, almacenamiento bloqueado): la app debe funcionar igual sin ello.

export function loadStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveStringSet(key: string, values: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...values]));
  } catch {
    // sin persistencia: el estado sigue en memoria
  }
}

export function loadString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sin persistencia: el estado sigue en memoria
  }
}
