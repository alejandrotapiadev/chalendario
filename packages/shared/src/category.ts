import { z } from 'zod';
import { COLOR_PATTERN } from '@calendar/domain';

const name = z.string().trim().min(1).max(60);
const color = z.string().regex(COLOR_PATTERN, 'debe tener el formato #rrggbb');

export const createCategorySchema = z.strictObject({
  name,
  color: color.optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.strictObject({
  name: name.optional(),
  color: color.optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export interface CategoryDto {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}
