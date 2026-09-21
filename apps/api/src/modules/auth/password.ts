import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** Parámetros recomendados por OWASP para scrypt (≈32 MiB por hash). */
export const DEFAULT_SCRYPT: ScryptParams = { N: 32_768, r: 8, p: 3 };

const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { N, r, p, maxmem: 256 * N * r },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Formato: `scrypt$N$r$p$sal$hash` (base64). Los parámetros viajan con el hash. */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, params);
  const { N, r, p } = params;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !N || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;

/**
 * Gasta el mismo tiempo que una verificación real. Se usa cuando el email no existe, para
 * que la respuesta no revele qué cuentas hay.
 */
export async function verifyAgainstDummy(password: string, params: ScryptParams): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing', params);
  await verifyPassword(password, await dummyHash);
}
