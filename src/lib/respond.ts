import type { APIInteractionResponse } from '../discord/types.js';
import { InteractionResponseType, MessageFlags } from '../discord/types.js';

export function ephemeral(content: string): APIInteractionResponse {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content, flags: MessageFlags.Ephemeral },
  };
}
