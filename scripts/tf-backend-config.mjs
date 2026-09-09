#!/usr/bin/env node
/**
 * Prints the `terraform init` backend flags for an instance, from instances.json
 * (ADR-006 §1: the pre-existing rc-tfstate bucket and this project's key):
 *
 *   terraform -chdir=terraform/instances/dev init $(node scripts/tf-backend-config.mjs dev)
 */
import { backendConfigFlags, selectInstance } from "./instance.mjs";

const name = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
process.stdout.write(`${backendConfigFlags(selectInstance(name)).join(" ")}\n`);
