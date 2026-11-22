import type { RngState } from './types.js';

/** sfc32, a small fast generator with 128 bits of state. The state lives in `GameState.rng`. */

function splitmix32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s ^ (s >>> 16);
    z = Math.imul(z, 0x21f0aaad);
    z = z ^ (z >>> 15);
    z = Math.imul(z, 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

export function createRng(seed: number): RngState {
  const next = splitmix32(seed);
  const state: RngState = [next(), next(), next(), next()];
  for (let i = 0; i < 12; i++) nextU32(state);
  return state;
}

/** Advances the state in place and returns an unsigned 32-bit integer. */
export function nextU32(r: RngState): number {
  let [a, b, c, d] = r;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  r[0] = a >>> 0;
  r[1] = b >>> 0;
  r[2] = c >>> 0;
  r[3] = d >>> 0;
  return t >>> 0;
}

/** A float in [0, 1). */
export function nextFloat(r: RngState): number {
  return nextU32(r) / 4294967296;
}

/** An integer in [0, n). */
export function nextInt(r: RngState, n: number): number {
  return Math.floor(nextFloat(r) * n);
}

/** An integer in [min, max]. */
export function nextRange(r: RngState, min: number, max: number): number {
  return min + nextInt(r, max - min + 1);
}

/** Fisher-Yates shuffle, in place. */
export function shuffle<T>(r: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(r, i + 1);
    const a = items[i] as T;
    items[i] = items[j] as T;
    items[j] = a;
  }
  return items;
}
