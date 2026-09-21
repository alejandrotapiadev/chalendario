import { z } from 'zod';

export const PASSWORD_MIN = 8;

export const registerSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(PASSWORD_MIN, `mínimo ${PASSWORD_MIN} caracteres`).max(200),
  name: z.string().trim().min(1).max(100),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface UserDto {
  id: string;
  email: string;
  name: string;
}
