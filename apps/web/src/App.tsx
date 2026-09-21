import { useEffect, useState } from 'react';
import type { HealthResponse } from '@calendar/shared';

export function App() {
  const [health, setHealth] = useState<HealthResponse | 'error' | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch(() => setHealth('error'));
  }, []);

  return (
    <main>
      <h1>Personal Calendar</h1>
      <p>
        API:{' '}
        {health === null ? 'comprobando…' : health === 'error' ? 'sin conexión' : health.status}
      </p>
    </main>
  );
}
