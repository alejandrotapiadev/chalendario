/** Respuesta de GET /health, compartida entre API y web. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  uptimeSeconds: number;
}
