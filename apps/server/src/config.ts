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
  /** Season length in days. */
  SEASON_DAYS: z.coerce.number().min(0.01).max(60).default(7),
  /** Pause between a season ending and the next starting, in hours. */
  SEASON_BREAK_HOURS: z.coerce
    .number()
    .min(0)
    .max(24 * 30)
    .default(0),
  /** Minutes between tick summary log lines (0 turns them off). */
  TICK_LOG_MINUTES: z.coerce
    .number()
    .min(0)
    .max(24 * 60)
    .default(15),
  /** Mark the session cookie `Secure`; set true behind HTTPS. */
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  /** Trust `X-Forwarded-For` for rate limiting; set true only behind a reverse proxy. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /** UTC hour after which the nightly backup runs. */
  BACKUP_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(3),
  BACKUP_KEEP: z.coerce.number().int().min(1).default(7),
  /** Development only: mounts `/api/dev` (seed bots, fast-forward the clock). Never enable in production. */
  DEV_SEED: z.enum(['true', 'false']).default('false'),
  /** Fill the city with computer-run crews that play like async humans (see game/README.md). */
  BOTS_ENABLED: z.enum(['true', 'false']).default('true'),
  /** Bots wanted while the city has no human players. */
  BOT_COUNT: z.coerce.number().int().min(0).max(24).default(6),
  /** Fewest bots kept however many humans have joined. */
  BOT_MIN: z.coerce.number().int().min(0).max(24).default(2),
  CLIENT_DIR: z.string().min(1).optional(),
});

export interface Config {
  readonly port: number;
  readonly dataDir: string;
  readonly clientDir: string | undefined;
  readonly tickMs: number;
  readonly snapshotMs: number;
  readonly worldSeed: number;
  readonly seasonDays: number;
  readonly seasonBreakHours: number;
  readonly tickLogMinutes: number;
  readonly cookieSecure: boolean;
  readonly trustProxy: boolean;
  readonly backupHourUtc: number;
  readonly backupKeep: number;
  readonly devSeed: boolean;
  readonly botsEnabled: boolean;
  readonly botCount: number;
  readonly botMin: number;
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
    seasonDays: parsed.data.SEASON_DAYS,
    seasonBreakHours: parsed.data.SEASON_BREAK_HOURS,
    tickLogMinutes: parsed.data.TICK_LOG_MINUTES,
    cookieSecure: parsed.data.COOKIE_SECURE === 'true',
    trustProxy: parsed.data.TRUST_PROXY === 'true',
    backupHourUtc: parsed.data.BACKUP_HOUR_UTC,
    backupKeep: parsed.data.BACKUP_KEEP,
    devSeed: parsed.data.DEV_SEED === 'true',
    botsEnabled: parsed.data.BOTS_ENABLED === 'true',
    botCount: parsed.data.BOT_COUNT,
    botMin: Math.min(parsed.data.BOT_MIN, parsed.data.BOT_COUNT),
  };
}
