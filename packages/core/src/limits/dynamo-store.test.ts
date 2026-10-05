import type { GetItemCommandInput, UpdateItemCommandInput } from "@aws-sdk/client-dynamodb";
import { describe, expect, it } from "vitest";
import { DynamoCounterStore, type DynamoLike } from "./dynamo-store.js";

/**
 * The DynamoDB counter store (#322, ADR-020 §2): one conditional atomic `UpdateItem` with `ADD`
 * per count, on table `pk` (S) with the `expiresAt` TTL. No AWS here: a fake client records the
 * request and answers the way DynamoDB does.
 */

const EXPIRES = new Date("2026-10-08T00:00:00.000Z");

function conditionFailed(current: number | undefined): Error {
  const error = new Error("The conditional request failed") as Error & {
    Item?: Record<string, { N: string }>;
  };
  error.name = "ConditionalCheckFailedException";
  if (current !== undefined) error.Item = { count: { N: String(current) } };
  return error;
}

function fake(answer: (input: UpdateItemCommandInput) => unknown): {
  client: DynamoLike;
  updates: UpdateItemCommandInput[];
  gets: GetItemCommandInput[];
} {
  const updates: UpdateItemCommandInput[] = [];
  const gets: GetItemCommandInput[] = [];
  return {
    updates,
    gets,
    client: {
      updateItem: async (input) => {
        updates.push(input);
        return answer(input) as never;
      },
      getItem: async (input) => {
        gets.push(input);
        return { Item: { pk: { S: "k" }, count: { N: "7" } } } as never;
      },
    },
  };
}

describe("DynamoCounterStore", () => {
  it("sends one conditional ADD with the TTL and returns the new count", async () => {
    const f = fake(() => ({ Attributes: { count: { N: "3" } } }));
    const store = new DynamoCounterStore({ tableName: "rc-federal-mcps-dev-limits", client: f.client });
    expect(await store.increment("svc#bls#2026-10-05", 1, EXPIRES, 490)).toEqual({
      value: 3,
      applied: true,
    });
    expect(f.updates).toHaveLength(1);
    const input = f.updates[0];
    expect(input?.TableName).toBe("rc-federal-mcps-dev-limits");
    expect(input?.Key).toEqual({ pk: { S: "svc#bls#2026-10-05" } });
    expect(input?.UpdateExpression).toBe("ADD #count :by SET #expiresAt = :expiresAt");
    expect(input?.ConditionExpression).toBe("attribute_not_exists(#count) OR #count <= :room");
    expect(input?.ExpressionAttributeNames).toEqual({ "#count": "count", "#expiresAt": "expiresAt" });
    expect(input?.ExpressionAttributeValues).toEqual({
      ":by": { N: "1" },
      ":expiresAt": { N: String(EXPIRES.getTime() / 1000) },
      ":room": { N: "489" },
    });
    expect(input?.ReturnValues).toBe("UPDATED_NEW");
    expect(input?.ReturnValuesOnConditionCheckFailure).toBe("ALL_OLD");
  });

  it("sends an unconditional ADD when there is no max", async () => {
    const f = fake(() => ({ Attributes: { count: { N: "1" } } }));
    const store = new DynamoCounterStore({ tableName: "t", client: f.client });
    await store.increment("k", 1, EXPIRES);
    expect(f.updates[0]?.ConditionExpression).toBeUndefined();
    expect(f.updates[0]?.ExpressionAttributeValues?.[":room"]).toBeUndefined();
  });

  it("reports a refused count, with the stored value, when the condition fails", async () => {
    const f = fake(() => {
      throw conditionFailed(490);
    });
    const store = new DynamoCounterStore({ tableName: "t", client: f.client });
    expect(await store.increment("k", 1, EXPIRES, 490)).toEqual({ value: 490, applied: false });
  });

  it("rethrows any other error, so the limiter can fail open", async () => {
    const f = fake(() => {
      throw new Error("ProvisionedThroughputExceededException");
    });
    const store = new DynamoCounterStore({ tableName: "t", client: f.client });
    await expect(store.increment("k", 1, EXPIRES, 5)).rejects.toThrow("ProvisionedThroughput");
  });

  it("reads a count with a strongly consistent GetItem, 0 when absent", async () => {
    const f = fake(() => ({}));
    const store = new DynamoCounterStore({ tableName: "t", client: f.client });
    expect(await store.get("k")).toBe(7);
    expect(f.gets[0]).toEqual({
      TableName: "t",
      Key: { pk: { S: "k" } },
      ConsistentRead: true,
      ProjectionExpression: "#count",
      ExpressionAttributeNames: { "#count": "count" },
    });
    const empty = new DynamoCounterStore({
      tableName: "t",
      client: { ...f.client, getItem: async () => ({}) as never },
    });
    expect(await empty.get("k")).toBe(0);
  });
});
