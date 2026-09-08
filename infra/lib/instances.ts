/**
 * The fleet-record loader (ADR-004 §1). `instances.json` at the repo root is
 * the only place an AWS account or region is named; every stack in `infra/`
 * reads its target through this module instead of hardcoding a value.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** `instances.json` lives at the repo root, two levels above `infra/lib`. */
const DEFAULT_INSTANCES_PATH = join(__dirname, "..", "..", "instances.json");

export interface InstanceDomain {
  readonly blsDomainName: string;
  readonly hostedZoneId: string;
  readonly hostedZoneName: string;
}

export interface InstanceSecrets {
  readonly bls: string;
}

export interface InstanceRecord {
  readonly name: string;
  readonly description: string;
  readonly account: string;
  readonly region: string;
  readonly environmentTag: string;
  readonly deployRoleArn: string;
  readonly domain: InstanceDomain;
  readonly secrets: InstanceSecrets;
}

interface InstancesFile {
  readonly instances: InstanceRecord[];
}

function requireString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`instances.json: ${context} is missing string field "${key}"`);
  }
  return value;
}

function requireObject(
  record: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  const value = record[key];
  if (typeof value !== "object" || value === null) {
    throw new Error(`instances.json: ${context} is missing object field "${key}"`);
  }
  return value as Record<string, unknown>;
}

function assertInstanceRecord(value: unknown, index: number): asserts value is InstanceRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error(`instances.json: entry ${index} is not an object`);
  }
  const record = value as Record<string, unknown>;
  const context = `entry ${index}`;

  for (const key of ["name", "description", "account", "region", "environmentTag", "deployRoleArn"]) {
    requireString(record, key, context);
  }

  const domain = requireObject(record, "domain", context);
  for (const key of ["blsDomainName", "hostedZoneId", "hostedZoneName"]) {
    requireString(domain, key, `${context} domain`);
  }

  const secrets = requireObject(record, "secrets", context);
  requireString(secrets, "bls", `${context} secrets`);
}

/** Parses and validates `instances.json`, defaulting to the repo-root file. */
export function loadInstances(path: string = DEFAULT_INSTANCES_PATH): InstanceRecord[] {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as InstancesFile).instances)
  ) {
    throw new Error(`instances.json at ${path} is missing an "instances" array`);
  }
  const instances = (parsed as InstancesFile).instances;
  instances.forEach((instance, index) => assertInstanceRecord(instance, index));
  return instances;
}

/**
 * Selects one instance record by name, defaulting to `FEDERAL_MCPS_INSTANCE`
 * (or `"dev"` when unset). Throws a clear error naming the known instances
 * when `name` does not match any record.
 */
export function selectInstance(
  name: string = process.env.FEDERAL_MCPS_INSTANCE ?? "dev",
  path?: string,
): InstanceRecord {
  const instances = loadInstances(path);
  const found = instances.find((instance) => instance.name === name);
  if (!found) {
    const known = instances.map((instance) => instance.name).join(", ");
    throw new Error(`Unknown federal-mcps instance "${name}". Known instances: ${known}`);
  }
  return found;
}

/**
 * The GitHub Actions concurrency group `.github/workflows/deploy.yml` (#10)
 * must use for its `concurrency.group` — computed here because the workflow
 * cannot expand `env` inside that block (ADR-004 §4), so #10 hardcodes the
 * literal string this function returns and a test asserts they match.
 */
export function deployConcurrencyGroup(instance: Pick<InstanceRecord, "name">): string {
  return `deploy-${instance.name}`;
}
