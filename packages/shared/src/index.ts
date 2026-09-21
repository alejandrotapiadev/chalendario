/** Respuesta de GET /health, compartida entre API y web. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  uptimeSeconds: number;
}

/** Forma de los errores de la API. */
export interface ApiErrorBody {
  error: string;
  message: string;
  issues?: string[];
}

export * from './calendar.ts';
export * from './event.ts';
