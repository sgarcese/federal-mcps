#!/usr/bin/env node
/**
 * Prints the `terraform init` backend flags for an instance, from instances.json:
 *
 *   terraform -chdir=terraform/instances/dev init $(node scripts/tf-backend-config.mjs dev)
 *
 * Also prints the bootstrap tfvars with `--bootstrap-vars` for terraform/bootstrap.
 */
import { backendConfigFlags, selectInstance } from "./instance.mjs";

const args = process.argv.slice(2);
const wantsBootstrapVars = args.includes("--bootstrap-vars");
const name = args.find((arg) => !arg.startsWith("--"));
const instance = selectInstance(name);

if (wantsBootstrapVars) {
  process.stdout.write(
    `${JSON.stringify(
      {
        account_id: instance.account,
        region: instance.region,
        environment_tag: instance.environmentTag,
      },
      null,
      2,
    )}\n`,
  );
} else {
  process.stdout.write(`${backendConfigFlags(instance).join(" ")}\n`);
}
