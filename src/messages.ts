export const messages = {
  createSuccess(channel: string): string {
    return `✅ チャンネルを作成しました → ${channel}\nあなただけに編集権限が付与されています。`;
  },

  createAlreadyOwns(): string {
    return '❌ 既にチャンネルを所有しています（1人1チャンネル制限）';
  },

  createNoName(): string {
    return '❌ チャンネル名が指定されていません';
  },

  internalError(): string {
    return '❌ 内部エラーが発生しました';
  },

  unknownCommand(): string {
    return '❌ 未知のコマンドです';
  },
};
