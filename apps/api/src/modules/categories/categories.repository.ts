import type { CategoryDto } from '@calendar/shared';
import { isUniqueViolation, type Queryable } from '../../db.ts';
import { ConflictError } from '../../errors.ts';

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = 'id, name::text AS name, color, archived, created_at, updated_at';

function toDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    archived: row.archived,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const nameTaken = () => new ConflictError('name_taken', 'Ya existe una categoría con ese nombre');

export async function listCategories(db: Queryable, userId: string): Promise<CategoryDto[]> {
  const { rows } = await db.query<CategoryRow>(
    `SELECT ${COLUMNS} FROM categories WHERE user_id = $1 ORDER BY name`,
    [userId],
  );
  return rows.map(toDto);
}

export async function insertCategory(
  db: Queryable,
  userId: string,
  input: { name: string; color?: string | undefined },
): Promise<CategoryDto> {
  try {
    const { rows } = await db.query<CategoryRow>(
      `INSERT INTO categories (user_id, name, color) VALUES ($1, $2, COALESCE($3, '#8b5cf6'))
       RETURNING ${COLUMNS}`,
      [userId, input.name, input.color ?? null],
    );
    return toDto(rows[0]!);
  } catch (err) {
    throw isUniqueViolation(err) ? nameTaken() : err;
  }
}

export async function updateCategory(
  db: Queryable,
  userId: string,
  id: string,
  input: {
    name?: string | undefined;
    color?: string | undefined;
    archived?: boolean | undefined;
  },
): Promise<CategoryDto | null> {
  try {
    const { rows } = await db.query<CategoryRow>(
      `UPDATE categories
          SET name = COALESCE($3, name), color = COALESCE($4, color),
              archived = COALESCE($5, archived), updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING ${COLUMNS}`,
      [id, userId, input.name ?? null, input.color ?? null, input.archived ?? null],
    );
    return rows[0] ? toDto(rows[0]) : null;
  } catch (err) {
    throw isUniqueViolation(err) ? nameTaken() : err;
  }
}

export async function categoryBelongsToUser(
  db: Queryable,
  userId: string,
  categoryId: string,
): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM categories WHERE id = $1 AND user_id = $2', [
    categoryId,
    userId,
  ]);
  return rowCount === 1;
}
