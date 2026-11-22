import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** scrypt parameters; stored in each hash so they can be raised later without breaking old ones. */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, len: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      len,
      { N: n, r, p, maxmem: 64 * 1024 * 1024 },
      (e, k) => (e ? reject(e) : resolve(k)),
    );
  });
}

/** `scrypt$N$r$p$salt$hash`, with a fresh 16-byte salt per call. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEYLEN);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Constant-time comparison of the derived key. Malformed stored hashes verify as false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const want = Buffer.from(parts[5] ?? '', 'base64');
  if (![n, r, p].every(Number.isInteger) || want.length === 0) return false;
  const got = await derive(password, salt, n, r, p, want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A valid hash of nothing in particular, verified against when the username is unknown so that
 *  login takes the same time either way. */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString('hex'));
  return dummy;
}
