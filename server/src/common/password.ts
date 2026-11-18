import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** scrypt$N$r$p$salt$hash；不引入第三方依赖。 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString('hex');
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt, hash].join('$');
}

export function verifyPassword(password: string, encoded: string): boolean {
  try {
    const [scheme, n, r, p, salt, hash] = String(encoded || '').split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = scryptSync(String(password), salt, expected.length, {
      N: Number(n) || SCRYPT_N,
      r: Number(r) || SCRYPT_R,
      p: Number(p) || SCRYPT_P,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** 生成便于线下转发的临时密码：大写/小写/数字各至少一个。 */
export function generateTemporaryPassword(length = 16): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (alphabet: string) => alphabet[randomBytes(1)[0] % alphabet.length];
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
