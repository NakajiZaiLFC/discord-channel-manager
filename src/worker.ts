import type { APIInteraction, APIInteractionResponse } from './discord/types.js';
import { InteractionType, InteractionResponseType, MessageFlags } from './discord/types.js';
import { verifySignature } from './verify.js';
import { validateEnv, type Env } from './config.js';
import { createCommandRouter } from './interactions/command-router.js';
import { registerCommands } from './commands/index.js';
import { runCleanup } from './cron.js';
import { DomainError } from './lib/errors.js';

const commandRouter = createCommandRouter();
registerCommands(commandRouter);

export default {
  async fetch(request: Request, rawEnv: unknown): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let env: Env;
    try { env = validateEnv(rawEnv); }
    catch (e) {
      console.error('[env] validation failed', e);
      return new Response('misconfiguration', { status: 500 });
    }

    const sig = request.headers.get('X-Signature-Ed25519');
    const ts = request.headers.get('X-Signature-Timestamp');
    if (!sig || !ts) return new Response('missing signature headers', { status: 401 });

    const raw = await request.text();
    if (!(await verifySignature(raw, sig, ts, env.DISCORD_PUBLIC_KEY))) {
      return new Response('invalid signature', { status: 401 });
    }

    let interaction: APIInteraction;
    try { interaction = JSON.parse(raw); }
    catch { return new Response('bad json', { status: 400 }); }

    try {
      const response = await dispatch(interaction, env);
      return json(response);
    } catch (e) {
      console.error('[worker] unhandled error', e);
      const msg = e instanceof DomainError ? e.userMessage : '❌ 内部エラーが発生しました';
      return json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: msg, flags: MessageFlags.Ephemeral },
      });
    }
  },

  async scheduled(_event: ScheduledEvent, rawEnv: unknown, _ctx: ExecutionContext): Promise<void> {
    let env: Env;
    try { env = validateEnv(rawEnv); }
    catch (e) { console.error('[cron] env validation failed', e); return; }
    const result = await runCleanup(env);
    console.log('[cron] cleanup complete', result);
  },
};

async function dispatch(interaction: APIInteraction, env: Env): Promise<APIInteractionResponse> {
  switch (interaction.type) {
    case InteractionType.Ping:
      return { type: InteractionResponseType.Pong };
    case InteractionType.ApplicationCommand:
      return commandRouter.handle(interaction, env);
    default:
      return {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: '❌ 未対応のインタラクションです', flags: MessageFlags.Ephemeral },
      };
  }
}

function json(res: APIInteractionResponse): Response {
  return new Response(JSON.stringify(res), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
