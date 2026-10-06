import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

// Stored as `salt:hash` in hex, so each hash carries the salt needed to check it.
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(plain, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const [salt, hash = ''] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  // A corrupt hash must never match: a shorter key is easier to guess, and an
  // empty one would equal any password's empty key.
  if (expected.length !== KEY_LENGTH) {
    return false;
  }
  const actual = await scryptAsync(plain, Buffer.from(salt, 'hex'), KEY_LENGTH);
  // Constant-time comparison so response timing doesn't leak how much matched.
  return timingSafeEqual(actual, expected);
}
