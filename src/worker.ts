import { verifySignature } from './verify.js';
import { handleCreate, handleClaim, handleMove, handleMoveAutocomplete, handleHelp } from './commands.js';
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

    // PING
    if (interaction.type === 1) {
      return json({ type: 1 });
    }

    // APPLICATION_COMMAND
    if (interaction.type === 2) {
      try {
        const command = interaction.data?.name;
        let response;

        switch (command) {
          case 'marvin-create':
            response = await handleCreate(interaction, env);
            break;
          case 'marvin-claim':
            response = await handleClaim(interaction, env);
            break;
          case 'marvin-move':
            response = await handleMove(interaction, env);
            break;
          case 'marvin-help':
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

    // APPLICATION_COMMAND_AUTOCOMPLETE
    if (interaction.type === 4) {
      try {
        const command = interaction.data?.name;
        if (command === 'marvin-move') {
          return json(await handleMoveAutocomplete(interaction, env));
        }
        return json({ type: 8, data: { choices: [] } });
      } catch (e) {
        console.error('[worker] autocomplete error:', e);
        return json({ type: 8, data: { choices: [] } });
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
