/**
 * The persistent limiter's counter store (#322, ADR-020 §2): daily counters shared by every
 * container of every server. `DynamoCounterStore` (dynamo-store.ts) is the deployed one;
 * `MemoryCounterStore` serves tests, local runs, and a deploy configured without a table.
 */

/** The outcome of one counted increment. */
export interface IncrementResult {
  /** The count after the increment, or the unchanged count when it was refused. */
  readonly value: number;
  /** False when `max` refused it: the count would have passed `max`, and nothing was written. */
  readonly applied: boolean;
}

export interface CounterStore {
  /**
   * Adds `by` to the counter `pk` atomically, setting its expiry to `expiresAt`. With `max`, the
   * add happens only when the result stays at or below `max`; otherwise nothing is written and
   * `applied` is false. Throws when the store itself fails (the limiter then fails open).
   */
  increment(pk: string, by: number, expiresAt: Date, max?: number): Promise<IncrementResult>;
  /** The counter's current value, 0 when it does not exist. */
  get(pk: string): Promise<number>;
}

/** An in-process counter store, one per container. */
export class MemoryCounterStore implements CounterStore {
  private readonly counts = new Map<string, { value: number; expiresAt: number }>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async increment(pk: string, by: number, expiresAt: Date, max?: number): Promise<IncrementResult> {
    const current = this.read(pk);
    if (max !== undefined && current + by > max) return { value: current, applied: false };
    const value = current + by;
    this.sweep();
    this.counts.set(pk, { value, expiresAt: expiresAt.getTime() });
    return { value, applied: true };
  }

  async get(pk: string): Promise<number> {
    return this.read(pk);
  }

  /**
   * Keys carry their day, so a stale counter is never read again; expiry only bounds memory, and
   * is swept as the map grows rather than checked on read (reads stay independent of the clock).
   */
  private read(pk: string): number {
    return this.counts.get(pk)?.value ?? 0;
  }

  private sweep(): void {
    if (this.counts.size < SWEEP_AT) return;
    const nowMs = this.now().getTime();
    for (const [pk, entry] of this.counts) {
      if (entry.expiresAt <= nowMs) this.counts.delete(pk);
    }
  }
}

const SWEEP_AT = 10_000;
