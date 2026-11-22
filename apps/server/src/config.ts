import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATA_DIR: z.string().min(1).default('./data'),
  /** Directory of the built client; the default suits both `src/` and `dist/`. */
  /** Milliseconds between sim ticks. */
  TICK_MS: z.coerce.number().int().min(100).max(60_000).default(2000),
  /** Milliseconds between periodic snapshots (one is also written on shutdown). */
  SNAPSHOT_MS: z.coerce.number().int().min(1000).default(300_000),
  /** Seed for the world created on first boot. Ignored once a database exists. */
  WORLD_SEED: z.coerce.number().int().default(20261122),
  /** Mark the session cookie `Secure`; set true behind HTTPS. */
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  /** Trust `X-Forwarded-For` for rate limiting; set true only behind a reverse proxy. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /** UTC hour after which the nightly backup runs. */
  BACKUP_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(3),
  BACKUP_KEEP: z.coerce.number().int().min(1).default(7),
  CLIENT_DIR: z.string().min(1).optional(),
});

export interface Config {
  readonly port: number;
  readonly dataDir: string;
  readonly clientDir: string | undefined;
  readonly tickMs: number;
  readonly snapshotMs: number;
  readonly worldSeed: number;
  readonly cookieSecure: boolean;
  readonly trustProxy: boolean;
  readonly backupHourUtc: number;
  readonly backupKeep: number;
}

/** Parse and validate the environment; throws a readable error when it is invalid. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  return {
    port: parsed.data.PORT,
    dataDir: parsed.data.DATA_DIR,
    clientDir: parsed.data.CLIENT_DIR,
    tickMs: parsed.data.TICK_MS,
    snapshotMs: parsed.data.SNAPSHOT_MS,
    worldSeed: parsed.data.WORLD_SEED,
    cookieSecure: parsed.data.COOKIE_SECURE === 'true',
    trustProxy: parsed.data.TRUST_PROXY === 'true',
    backupHourUtc: parsed.data.BACKUP_HOUR_UTC,
    backupKeep: parsed.data.BACKUP_KEEP,
  };
}
