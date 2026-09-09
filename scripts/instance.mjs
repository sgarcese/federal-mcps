/**
 * The fleet-record loader (ADR-004 §1, ADR-005 §5), shared by the deploy
 * workflow, the Terraform backend-config helper and tests. Plain ESM so the
 * workflow can run it with `node` and no build step.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_INSTANCES_PATH = join(here, "..", "instances.json");

const REQUIRED_STRINGS = [
  "name",
  "description",
  "account",
  "region",
  "environmentTag",
  "deployRoleArn",
];

/**
 * @typedef {{ name: string; description: string; account: string; region: string;
 *   environmentTag: string; deployRoleArn: string;
 *   domain: { blsDomainName: string; hostedZoneId: string; hostedZoneName: string };
 *   secrets: { bls: string } }} InstanceRecord
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
  for (const key of ["blsDomainName", "hostedZoneId", "hostedZoneName"]) {
    if (typeof (/** @type {Record<string, unknown>} */ (domain)[key]) !== "string") {
      throw new Error(`instances.json: entry ${index} domain is missing string field "${key}"`);
    }
  }
  const secrets = record.secrets;
  if (
    typeof secrets !== "object" ||
    secrets === null ||
    typeof (/** @type {Record<string, unknown>} */ (secrets).bls) !== "string"
  ) {
    throw new Error(`instances.json: entry ${index} secrets is missing string field "bls"`);
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

/** The Terraform state bucket for an instance (ADR-005 §1). */
export function stateBucket(instance) {
  return `federal-mcps-tfstate-${instance.account}`;
}

/**
 * The GitHub Actions concurrency group deploy.yml must hardcode (ADR-004 §4):
 * the workflow cannot expand `env` inside its `concurrency` block, so a test
 * asserts the literal in the file equals this.
 */
export function deployConcurrencyGroup(instance) {
  return `deploy-${instance.name}`;
}

/** `-backend-config` flags for `terraform init` in the instance root. */
export function backendConfigFlags(instance) {
  return [
    `-backend-config=bucket=${stateBucket(instance)}`,
    `-backend-config=region=${instance.region}`,
  ];
}
