import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createCategorySchema, updateCategorySchema } from '@calendar/shared';
import type { Db } from '../../db.ts';
import { NotFoundError } from '../../errors.ts';
import { insertCategory, listCategories, updateCategory } from './categories.repository.ts';

const params = z.object({ id: z.uuid() });

// No hay DELETE: las versiones de los eventos son inmutables y referencian la categoría
// (ADR-002). Se renombra o se recolorea.
export function registerCategoryRoutes(app: FastifyInstance, db: Db): void {
  app.get('/categories', async (request) => listCategories(db, request.userId));

  app.post('/categories', async (request, reply) => {
    const input = createCategorySchema.parse(request.body);
    return reply.code(201).send(await insertCategory(db, request.userId, input));
  });

  app.patch('/categories/:id', async (request) => {
    const { id } = params.parse(request.params);
    const input = updateCategorySchema.parse(request.body);
    const category = await updateCategory(db, request.userId, id, input);
    if (!category) throw new NotFoundError('Categoría');
    return category;
  });
}
