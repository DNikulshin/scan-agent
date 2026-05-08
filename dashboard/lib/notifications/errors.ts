// Сигнальные ошибки каналов: dispatcher решает по типу — retry или сразу fail.

export class RetryableError extends Error {
  readonly retryAfterSec?: number;
  constructor(message: string, retryAfterSec?: number) {
    super(message);
    this.name = "RetryableError";
    this.retryAfterSec = retryAfterSec;
  }
}

export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalError";
  }
}
