import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATA_DIR: z.string().min(1).default('./data'),
  /** Directory of the built client; the default suits both `src/` and `dist/`. */
  CLIENT_DIR: z.string().min(1).optional(),
});

export interface Config {
  readonly port: number;
  readonly dataDir: string;
  readonly clientDir: string | undefined;
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
  };
}
