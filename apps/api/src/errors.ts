import type { FastifyInstance } from 'fastify';
import { InvalidEventError } from '@calendar/domain';
import type { ApiErrorBody } from '@calendar/shared';
import { ZodError } from 'zod';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(404, 'not_found', `${what} no encontrado`);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

function zodIssues(error: ZodError): string[] {
  return error.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ` : '') + i.message);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request, reply) => {
    let status = 500;
    let body: ApiErrorBody = { error: 'internal_error', message: 'Error interno del servidor' };

    if (error instanceof ZodError) {
      status = 400;
      body = { error: 'validation_error', message: 'Datos inválidos', issues: zodIssues(error) };
    } else if (error instanceof InvalidEventError) {
      status = 400;
      body = { error: 'invalid_event', message: 'Evento inválido', issues: error.issues };
    } else if (error instanceof AppError) {
      status = error.statusCode;
      body = { error: error.code, message: error.message };
    } else if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    ) {
      // Errores propios de Fastify: JSON mal formado, cuerpo demasiado grande…
      status = error.statusCode;
      body = { error: 'bad_request', message: error.message };
    }

    if (status >= 500) request.log.error({ err: error }, 'unhandled error');
    return reply.code(status).send(body);
  });

  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .send({ error: 'not_found', message: 'Ruta no encontrada' } satisfies ApiErrorBody),
  );
}
