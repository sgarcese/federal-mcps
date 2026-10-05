import type {
  GetItemCommandInput,
  GetItemCommandOutput,
  UpdateItemCommandInput,
  UpdateItemCommandOutput,
} from "@aws-sdk/client-dynamodb";
import type { CounterStore, IncrementResult } from "./counter-store.js";

/**
 * The DynamoDB counter store (#322, ADR-020 §2, §10). The table, created by
 * `scripts/admin-grant-protection.sh` as `rc-federal-mcps-<env>-limits`, has partition key `pk` (S)
 * and TTL attribute `expiresAt` (epoch seconds); each item carries one numeric `count`. Every count
 * is one conditional atomic `UpdateItem` with `ADD`, so concurrent containers never lose an update
 * and a refused count writes nothing. The execution roles hold `UpdateItem` and `GetItem` only.
 */

/** The two DynamoDB calls the store makes; the SDK's aggregated `DynamoDB` client satisfies it. */
export interface DynamoLike {
  updateItem(input: UpdateItemCommandInput): Promise<UpdateItemCommandOutput>;
  getItem(input: GetItemCommandInput): Promise<GetItemCommandOutput>;
}

export interface DynamoCounterStoreOptions {
  readonly tableName: string;
  /** Injectable for tests. Default: the SDK client, loaded on first use from the Lambda runtime. */
  readonly client?: DynamoLike;
}

const COUNT = "count";
const NAMES = { "#count": COUNT, "#expiresAt": "expiresAt" } as const;

export class DynamoCounterStore implements CounterStore {
  private readonly tableName: string;
  private client: Promise<DynamoLike> | undefined;

  constructor(options: DynamoCounterStoreOptions) {
    this.tableName = options.tableName;
    if (options.client !== undefined) this.client = Promise.resolve(options.client);
  }

  async increment(pk: string, by: number, expiresAt: Date, max?: number): Promise<IncrementResult> {
    const client = await this.dynamo();
    const conditional = max !== undefined;
    try {
      const output = await client.updateItem({
        TableName: this.tableName,
        Key: { pk: { S: pk } },
        UpdateExpression: "ADD #count :by SET #expiresAt = :expiresAt",
        ...(conditional
          ? { ConditionExpression: "attribute_not_exists(#count) OR #count <= :room" }
          : {}),
        ExpressionAttributeNames: NAMES,
        ExpressionAttributeValues: {
          ":by": { N: String(by) },
          ":expiresAt": { N: String(Math.floor(expiresAt.getTime() / 1000)) },
          ...(conditional ? { ":room": { N: String(max - by) } } : {}),
        },
        ReturnValues: "UPDATED_NEW",
        ...(conditional ? { ReturnValuesOnConditionCheckFailure: "ALL_OLD" as const } : {}),
      });
      return { value: numberOf(output.Attributes?.[COUNT]), applied: true };
    } catch (error) {
      if (isConditionFailed(error)) {
        return { value: numberOf(error.Item?.[COUNT]), applied: false };
      }
      throw error;
    }
  }

  async get(pk: string): Promise<number> {
    const client = await this.dynamo();
    const output = await client.getItem({
      TableName: this.tableName,
      Key: { pk: { S: pk } },
      ConsistentRead: true,
      ProjectionExpression: "#count",
      ExpressionAttributeNames: { "#count": "count" },
    });
    return numberOf(output.Item?.[COUNT]);
  }

  /**
   * Loaded lazily so stdio and local runs, which never build this store, never load the SDK; on
   * Lambda the Node runtime provides `@aws-sdk/*`, which the bundle leaves external.
   */
  private dynamo(): Promise<DynamoLike> {
    this.client ??= import("@aws-sdk/client-dynamodb").then(({ DynamoDB }) => new DynamoDB({}));
    return this.client;
  }
}

function numberOf(value: { N?: string } | undefined): number {
  const n = Number(value?.N ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isConditionFailed(
  error: unknown,
): error is Error & { Item?: Record<string, { N?: string }> } {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}
