import { verifySignature } from './verify.js';
import { handleCreate, handleClaim, handleMoveList, handleMoveTo, handleHelp } from './commands.js';
import { messages } from './messages.js';

interface Env {
  GUILD_ID: string;
  ADMIN_ROLE_IDS: string;
  PERSONAL_CHANNELS_CATEGORY_ID: string;
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const sig = request.headers.get('X-Signature-Ed25519');
    const ts = request.headers.get('X-Signature-Timestamp');
    if (!sig || !ts) return new Response('missing signature headers', { status: 401 });

    const raw = await request.text();
    if (!(await verifySignature(raw, sig, ts, env.DISCORD_PUBLIC_KEY))) {
      return new Response('invalid signature', { status: 401 });
    }

    const interaction = JSON.parse(raw);

    if (interaction.type === 1) {
      return json({ type: 1 });
    }

    if (interaction.type === 2) {
      try {
        const command = interaction.data?.name;
        const sub = interaction.data?.options?.[0]?.name;
        let response;

        switch (command) {
          case 'channel':
            switch (sub) {
              case 'create': response = await handleCreate(interaction, env); break;
              case 'claim':  response = await handleClaim(interaction, env); break;
              default:       response = ephemeral(messages.unknownCommand());
            }
            break;
          case 'move':
            switch (sub) {
              case 'list': response = await handleMoveList(interaction, env); break;
              case 'to':   response = await handleMoveTo(interaction, env); break;
              default:     response = ephemeral(messages.unknownCommand());
            }
            break;
          case 'help':
            response = handleHelp();
            break;
          default:
            response = ephemeral(messages.unknownCommand());
        }

        return json(response);
      } catch (e) {
        console.error('[worker] error:', e);
        return json(ephemeral(messages.internalError()));
      }
    }

    return json(ephemeral(messages.unknownCommand()));
  },
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function ephemeral(content: string) {
  return { type: 4, data: { content, flags: 64 } };
}
