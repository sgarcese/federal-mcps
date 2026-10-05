/**
 * The fleet-record loader (ADR-004 §1, ADR-005 §5), shared by the deploy
 * workflow, the Terraform backend-config helper and tests. Plain ESM so the
 * workflow can run it with `node` and no build step.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/**
 * The real fleet record is gitignored (per-deployer, holds the AWS account; ADR-004). When it is
 * absent — CI, a fresh clone — fall back to the committed `instances.example.json` placeholder, so
 * validation and mocked terraform tests run without any deployer's account.
 */
const REAL_INSTANCES_PATH = join(here, "..", "instances.json");
const EXAMPLE_INSTANCES_PATH = join(here, "..", "instances.example.json");
export const DEFAULT_INSTANCES_PATH = existsSync(REAL_INSTANCES_PATH)
  ? REAL_INSTANCES_PATH
  : EXAMPLE_INSTANCES_PATH;

const REQUIRED_STRINGS = ["name", "description", "account", "region", "environmentTag"];

/**
 * @typedef {{ name: string; description: string; account: string; region: string;
 *   environmentTag: string;
 *   domain: { blsDomainName: string; geoDomainName: string; censusDomainName: string; cdcDomainName: string; hudDomainName: string; beaDomainName: string; hostedZoneId: string; hostedZoneName: string;
 *     aliases?: { bls?: string[]; geo?: string[]; census?: string[]; cdc?: string[]; hud?: string[]; bea?: string[] } };
 *   terraform: { stateBucket: string; stateKey: string };
 *   naming: { blsService: string; geoService: string; censusService: string; cdcService: string; hudService: string; beaService: string };
 *   limits?: Record<string, { stageRateLimit?: number; stageBurstLimit?: number; reservedConcurrency?: number;
 *     serviceDaily?: number; network?: { upstreamDaily?: number; toolCallsDaily?: number };
 *     pool?: { upstreamDaily?: number; toolCallsDaily?: number }; upstreamPerMinute?: number;
 *     upstreamErrorsPerMinute?: number }>;
 *   alerts?: { email?: string } }} InstanceRecord
 */

/**
 * @param {unknown} value
 * @param {number} index
 * @returns {InstanceRecord}
 */
function assertRecord(value, index) {
  if (typeof value !== "object" || value === null) {
    throw new Error(`instances.json: entry ${index} is not an object`);
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  for (const key of REQUIRED_STRINGS) {
    if (typeof record[key] !== "string") {
      throw new Error(`instances.json: entry ${index} is missing string field "${key}"`);
    }
  }
  const domain = record.domain;
  if (typeof domain !== "object" || domain === null) {
    throw new Error(`instances.json: entry ${index} is missing object field "domain"`);
  }
  for (const key of [
    "blsDomainName",
    "geoDomainName",
    "censusDomainName",
    "cdcDomainName",
    "hudDomainName",
    "beaDomainName",
    "hostedZoneId",
    "hostedZoneName",
  ]) {
    if (typeof (/** @type {Record<string, unknown>} */ (domain)[key]) !== "string") {
      throw new Error(`instances.json: entry ${index} domain is missing string field "${key}"`);
    }
  }
  // ADR-016 §2: optional extra hostnames per service; each must be a list of strings.
  const aliases = /** @type {Record<string, unknown>} */ (domain).aliases;
  if (aliases !== undefined) {
    if (typeof aliases !== "object" || aliases === null) {
      throw new Error(`instances.json: entry ${index} domain.aliases must be an object`);
    }
    for (const [service, list] of Object.entries(aliases)) {
      if (!["bls", "geo", "census", "cdc", "hud", "bea"].includes(service)) {
        throw new Error(
          `instances.json: entry ${index} domain.aliases has unknown service "${service}"`,
        );
      }
      if (!Array.isArray(list) || !list.every((h) => typeof h === "string" && h.length > 0)) {
        throw new Error(
          `instances.json: entry ${index} domain.aliases.${service} must be a list of hostnames`,
        );
      }
    }
  }
  // #319, ADR-020 §7: an optional `limits` block per server, flowing through
  // terraform/instances/<name>/locals.tf into each module's throttling, reserved
  // concurrency and FEDERAL_MCPS_LIMITS variables. Module defaults already carry
  // ADR-020's table, so this block is only needed to override it.
  const limits = record.limits;
  if (limits !== undefined) {
    if (typeof limits !== "object" || limits === null) {
      throw new Error(`instances.json: entry ${index} limits must be an object`);
    }
    const LIMITS_SERVICES = ["bls", "census", "hud", "bea", "geo", "cdc"];
    const LIMITS_NUMBER_FIELDS = [
      "stageRateLimit",
      "stageBurstLimit",
      "reservedConcurrency",
      "serviceDaily",
      "upstreamPerMinute",
      "upstreamErrorsPerMinute",
    ];
    const LIMITS_SHARE_FIELDS = ["upstreamDaily", "toolCallsDaily"];
    for (const [service, entry] of Object.entries(limits)) {
      if (!LIMITS_SERVICES.includes(service)) {
        throw new Error(`instances.json: entry ${index} limits has unknown service "${service}"`);
      }
      if (typeof entry !== "object" || entry === null) {
        throw new Error(`instances.json: entry ${index} limits.${service} must be an object`);
      }
      const entryRecord = /** @type {Record<string, unknown>} */ (entry);
      for (const field of LIMITS_NUMBER_FIELDS) {
        if (entryRecord[field] !== undefined && typeof entryRecord[field] !== "number") {
          throw new Error(
            `instances.json: entry ${index} limits.${service}.${field} must be a number`,
          );
        }
      }
      for (const shareField of ["network", "pool"]) {
        const share = entryRecord[shareField];
        if (share === undefined) continue;
        if (typeof share !== "object" || share === null) {
          throw new Error(
            `instances.json: entry ${index} limits.${service}.${shareField} must be an object`,
          );
        }
        const shareRecord = /** @type {Record<string, unknown>} */ (share);
        for (const field of LIMITS_SHARE_FIELDS) {
          if (shareRecord[field] !== undefined && typeof shareRecord[field] !== "number") {
            throw new Error(
              `instances.json: entry ${index} limits.${service}.${shareField}.${field} must be a number`,
            );
          }
        }
      }
    }
  }

  // #326, ADR-020 §5: an optional `alerts` block, read by terraform/modules/monitoring's
  // wiring in terraform/instances/<name>/main.tf. The alert email is never committed (it is
  // per-deployer, like the account): with no email, no SNS subscription and no Budgets
  // notification are created. A placeholder lives in instances.example.json for shape only.
  const alerts = record.alerts;
  if (alerts !== undefined) {
    if (typeof alerts !== "object" || alerts === null) {
      throw new Error(`instances.json: entry ${index} alerts must be an object`);
    }
    const alertsRecord = /** @type {Record<string, unknown>} */ (alerts);
    if (alertsRecord.email !== undefined) {
      if (typeof alertsRecord.email !== "string") {
        throw new Error(`instances.json: entry ${index} alerts.email must be a string`);
      }
      // A plain, deliberately unfussy shape check (not RFC 5322) — just enough to catch a
      // typo or a placeholder left in place, not a general email validator.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertsRecord.email)) {
        throw new Error(
          `instances.json: entry ${index} alerts.email must look like an email address`,
        );
      }
    }
  }

  const terraform = record.terraform;
  if (typeof terraform !== "object" || terraform === null) {
    throw new Error(`instances.json: entry ${index} is missing object field "terraform"`);
  }
  for (const key of ["stateBucket", "stateKey"]) {
    if (typeof (/** @type {Record<string, unknown>} */ (terraform)[key]) !== "string") {
      throw new Error(`instances.json: entry ${index} terraform is missing string field "${key}"`);
    }
  }
  const naming = record.naming;
  if (typeof naming !== "object" || naming === null) {
    throw new Error(`instances.json: entry ${index} is missing object field "naming"`);
  }
  for (const key of [
    "blsService",
    "geoService",
    "censusService",
    "cdcService",
    "hudService",
    "beaService",
  ]) {
    if (typeof (/** @type {Record<string, unknown>} */ (naming)[key]) !== "string") {
      throw new Error(`instances.json: entry ${index} naming is missing string field "${key}"`);
    }
  }
  return /** @type {InstanceRecord} */ (record);
}

/**
 * @param {string} [path]
 * @returns {InstanceRecord[]}
 */
export function loadInstances(path = DEFAULT_INSTANCES_PATH) {
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.instances)) {
    throw new Error(`instances.json at ${path} is missing an "instances" array`);
  }
  return parsed.instances.map(assertRecord);
}

/**
 * @param {string} [name]
 * @param {string} [path]
 * @returns {InstanceRecord}
 */
export function selectInstance(name = process.env.FEDERAL_MCPS_INSTANCE ?? "dev", path) {
  const instances = loadInstances(path);
  const found = instances.find((instance) => instance.name === name);
  if (!found) {
    const known = instances.map((instance) => instance.name).join(", ");
    throw new Error(`Unknown federal-mcps instance "${name}". Known instances: ${known}`);
  }
  return found;
}

/** The pre-existing Terraform state bucket for an instance (ADR-006 §1). */
export function stateBucket(instance) {
  return instance.terraform.stateBucket;
}

/** `-backend-config` flags for `terraform init` in the instance root (ADR-006 §1). */
export function backendConfigFlags(instance) {
  return [
    `-backend-config=bucket=${stateBucket(instance)}`,
    `-backend-config=key=${instance.terraform.stateKey}`,
    `-backend-config=region=${instance.region}`,
  ];
}
