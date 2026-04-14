import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import { InteractionResponseType, MessageFlags } from '../discord/types.js';
import type { Env } from '../config.js';

export interface CommandHandler {
  (interaction: APIApplicationCommandInteraction, env: Env): Promise<APIInteractionResponse>;
}

export interface CommandRouter {
  handle(interaction: APIApplicationCommandInteraction, env: Env): Promise<APIInteractionResponse>;
  register(commandName: string, subcommand: string, handler: CommandHandler): void;
}

export function createCommandRouter(): CommandRouter {
  const handlers = new Map<string, CommandHandler>();
  const key = (c: string, s: string) => `${c}/${s}`;
  return {
    register(c, s, h) { handlers.set(key(c, s), h); },
    async handle(interaction, env) {
      const data = interaction.data as unknown as { name: string; options?: Array<{ name: string; type: number }> };
      const top = data.options?.[0];
      const sub = top?.type === 1 ? top.name : '';
      const h = handlers.get(key(data.name, sub));
      if (!h) {
        return {
          type: InteractionResponseType.ChannelMessageWithSource,
          data: { content: '❌ 未知のコマンドです', flags: MessageFlags.Ephemeral },
        };
      }
      return h(interaction, env);
    },
  };
}
