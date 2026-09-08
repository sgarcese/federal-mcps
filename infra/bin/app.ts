#!/usr/bin/env -S npx tsx
import { App } from "aws-cdk-lib";
import { FederalMcpsCiCd } from "../lib/cicd-stack.js";
import { selectInstance } from "../lib/instances.js";

const instance = selectInstance();

const app = new App();

new FederalMcpsCiCd(app, "FederalMcpsCiCd", {
  instance,
  env: { account: instance.account, region: instance.region },
  description: `GitHub OIDC deploy role for federal-mcps (instance: ${instance.name}).`,
});
