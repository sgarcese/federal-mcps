/**
 * Per-source daily call budget (issue #5). In-memory only in M1; the M3
 * DynamoDB store implements the same `BudgetStore` interface.
 */
export interface BudgetConsumeResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetsAt: string;
}

export interface BudgetStore {
  consume(source: string, n: number): Promise<BudgetConsumeResult>;
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextUtcMidnight(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0),
  ).toISOString();
}

export class MemoryBudgetStore implements BudgetStore {
  private readonly used = new Map<string, number>();
  private readonly limitPerDay: number;
  private readonly now: () => Date;

  constructor(limitPerDay: number, now: () => Date = () => new Date()) {
    this.limitPerDay = limitPerDay;
    this.now = now;
  }

  async consume(source: string, n: number): Promise<BudgetConsumeResult> {
    const nowDate = this.now();
    const key = `${source}:${utcDateKey(nowDate)}`;
    const resetsAt = nextUtcMidnight(nowDate);
    const usedSoFar = this.used.get(key) ?? 0;

    if (usedSoFar + n > this.limitPerDay) {
      return { allowed: false, remaining: Math.max(0, this.limitPerDay - usedSoFar), resetsAt };
    }

    const newUsed = usedSoFar + n;
    this.used.set(key, newUsed);
    return { allowed: true, remaining: this.limitPerDay - newUsed, resetsAt };
  }
}
