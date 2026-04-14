import { z } from 'zod';

const snowflake = z.string().regex(/^\d{15,25}$/, 'must be a Discord snowflake');
const snowflakeList = z.string().transform(s =>
  s.split(',').map(x => x.trim()).filter(Boolean)
).pipe(z.array(snowflake).min(1));

export const EnvSchema = z.object({
  GUILD_ID: snowflake,
  ADMIN_ROLE_IDS: snowflakeList,
  PERSONAL_CHANNELS_CATEGORY_ID: snowflake,
  EVENT_LOG_CHANNEL_ID: snowflake,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  DISCORD_APPLICATION_ID: snowflake,
  DB: z.any(),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: unknown): Env {
  return EnvSchema.parse(raw);
}
