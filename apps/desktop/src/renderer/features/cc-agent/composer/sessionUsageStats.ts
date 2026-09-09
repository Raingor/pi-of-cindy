import type { TurnUsageDetails } from '../../../../shared/turnUsageDetails';
import type { ChatMessage } from '@/lib/makerChatStore';

/** 最近一条带有完整用量明细的助手消息，代表最近完成的一轮。 */
export function findLatestTurnUsageDetails(
  messages: readonly Pick<ChatMessage, 'role' | 'turnUsageDetails'>[],
): TurnUsageDetails | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && message.turnUsageDetails) {
      return message.turnUsageDetails;
    }
  }
  return null;
}
