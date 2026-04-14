export class DomainError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string, cause?: unknown) {
    super(userMessage);
    this.userMessage = userMessage;
    this.cause = cause;
    this.name = this.constructor.name;
  }
}

export class NotOwnerError extends DomainError {
  constructor() {
    super('❌ あなたはこのチャンネルのオーナーではありません');
  }
}

export class QuotaExceededError extends DomainError {
  constructor() {
    super('❌ すでにチャンネルを所有しています（1人1チャンネル制限）');
  }
}

export class NotRegisteredError extends DomainError {
  constructor() {
    super('❌ このチャンネルは Bot に登録されていません（管理者に `/channel claim` を依頼してください）');
  }
}

export class InvalidLocationError extends DomainError {
  constructor(msg: string) {
    super(msg);
  }
}

export class DiscordApiError extends DomainError {
  constructor(status: number, body: string) {
    super(`❌ Discord API エラー (${status})`, { status, body });
  }
}
