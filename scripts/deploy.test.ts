import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deployConcurrencyGroup, selectInstance } from "./instance.mjs";

const repoRoot = join(import.meta.dirname, "..");
const workflowPath = join(repoRoot, ".github", "workflows", "deploy.yml");
const workflow = readFileSync(workflowPath, "utf-8");

describe("deploy.yml", () => {
  it("triggers on push to main only, skipping docs-only paths", () => {
    expect(workflow).toMatch(/name:\s*Deploy/);
    expect(workflow).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]/);
    expect(workflow).toMatch(/paths:\s*\n\s*-\s*"\*\*"\s*\n\s*-\s*"!docs\/\*\*"/);
  });

  it("declares only id-token: write and contents: read permissions", () => {
    expect(workflow).toMatch(/permissions:\s*\n\s*id-token:\s*write\s*\n\s*contents:\s*read/);
  });

  it("sets FEDERAL_MCPS_INSTANCE to dev", () => {
    expect(workflow).toMatch(/env:\s*\n\s*FEDERAL_MCPS_INSTANCE:\s*dev/);
  });

  it("uses the literal concurrency group from deployConcurrencyGroup(selectInstance())", () => {
    const group = deployConcurrencyGroup(selectInstance());
    expect(workflow).toContain(`group: ${group}`);
    expect(workflow).toMatch(/concurrency:\s*\n\s*group:\s*deploy-dev\s*\n\s*cancel-in-progress:\s*false/);
  });

  it("names the job deploy, runs on ubuntu-latest with a 30 minute timeout", () => {
    expect(workflow).toMatch(/\n {2}deploy:\s*\n/);
    expect(workflow).toMatch(/runs-on:\s*ubuntu-latest/);
    expect(workflow).toMatch(/timeout-minutes:\s*30/);
  });

  it("every uses: is pinned to a major version", () => {
    const usesLines = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(usesLines.length).toBeGreaterThan(0);
    for (const usesLine of usesLines) {
      expect(usesLine).toMatch(/@v\d+$/);
    }
  });

  it("checks out with actions/checkout@v5", () => {
    expect(workflow).toMatch(/uses:\s*actions\/checkout@v5/);
  });

  it("sets up node with setup-node@v5, node-version-file .nvmrc, npm cache", () => {
    expect(workflow).toMatch(/uses:\s*actions\/setup-node@v5/);
    expect(workflow).toMatch(/node-version-file:\s*\.nvmrc/);
    expect(workflow).toMatch(/cache:\s*npm/);
  });

  it("resolves the instance via scripts/instance.mjs with id: instance, not jq on instances.json", () => {
    expect(workflow).toMatch(/Resolve the instance/);
    expect(workflow).toMatch(/id:\s*instance/);
    expect(workflow).toContain("scripts/instance.mjs");
    expect(workflow).not.toMatch(/jq\s+.*instances\.json/);
    expect(workflow).toContain("account");
    expect(workflow).toContain("region");
    expect(workflow).toContain("deploy_role_arn");
    expect(workflow).toContain("bls_domain");
    expect(workflow).toContain("state_bucket");
    expect(workflow).toContain("backend_flags");
    expect(workflow).toContain("GITHUB_OUTPUT");
  });

  it("installs, builds and bundles the BLS server package before touching AWS", () => {
    const resolveIdx = workflow.indexOf("Resolve the instance");
    const ciIdx = workflow.indexOf("npm ci");
    const buildIdx = workflow.indexOf("npm run build");
    const bundleIdx = workflow.indexOf("npm run bundle -w packages/server-bls");
    const credsIdx = workflow.indexOf("aws-actions/configure-aws-credentials");
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(ciIdx).toBeGreaterThan(resolveIdx);
    expect(buildIdx).toBeGreaterThan(ciIdx);
    expect(bundleIdx).toBeGreaterThan(buildIdx);
    expect(credsIdx).toBeGreaterThan(bundleIdx);
  });

  it("sets up terraform 1.15.5 with the wrapper disabled", () => {
    expect(workflow).toMatch(/uses:\s*hashicorp\/setup-terraform@v4/);
    expect(workflow).toMatch(/terraform_version:\s*"1\.15\.5"/);
    expect(workflow).toMatch(/terraform_wrapper:\s*false/);
  });

  it("configures AWS credentials via OIDC from the resolved instance, never static keys", () => {
    expect(workflow).toMatch(/uses:\s*aws-actions\/configure-aws-credentials@v6/);
    expect(workflow).toContain("steps.instance.outputs.deploy_role_arn");
    expect(workflow).toContain("steps.instance.outputs.region");
    expect(workflow).toContain("role-session-name");
    expect(workflow).toContain("github.run_id");
    expect(workflow).not.toContain("AWS_ACCESS_KEY");
    expect(workflow).not.toContain("AWS_SECRET");
  });

  it("runs terraform init with backend flags passed via env, not inline expression interpolation", () => {
    expect(workflow).toMatch(/Terraform init/);
    expect(workflow).toContain("terraform -chdir=terraform/instances/dev init -input=false");
    expect(workflow).toContain("BACKEND_FLAGS");
    // The flags must come from env + shell expansion, not a ${{ }} inline in run:
    expect(workflow).not.toMatch(/init -input=false \$\{\{ steps\.instance\.outputs\.backend_flags \}\}/);
  });

  it("runs terraform plan with -out=tfplan", () => {
    expect(workflow).toMatch(/Terraform plan/);
    expect(workflow).toContain(
      "terraform -chdir=terraform/instances/dev plan -input=false -out=tfplan",
    );
  });

  it("runs terraform apply against the saved plan", () => {
    expect(workflow).toMatch(/Terraform apply/);
    expect(workflow).toContain("terraform -chdir=terraform/instances/dev apply -input=false tfplan");
  });

  it("verifies the deployed server via custom_domain_url, MCP initialize and tools/list, checking for bls_describe_source", () => {
    expect(workflow).toMatch(/Verify the deployed server/);
    expect(workflow).toContain("terraform -chdir=terraform/instances/dev output -raw custom_domain_url");
    expect(workflow).toMatch(/::error::/);
    expect(workflow).toContain("initialize");
    expect(workflow).toContain("2025-06-18");
    expect(workflow).toContain("tools/list");
    expect(workflow).toContain("content-type: application/json");
    expect(workflow).toContain("application/json, text/event-stream");
    expect(workflow).toContain("--fail-with-body");
    expect(workflow).toContain("--retry 5");
    expect(workflow).toContain("--retry-delay 10");
    expect(workflow).toContain("--retry-all-errors");
    expect(workflow).toContain("bls_describe_source");
    expect(workflow).toContain("GITHUB_SHA");
    expect(workflow).toMatch(/deployed \$GITHUB_SHA to/);
  });

  it("never interpolates github.event.* into a run: block", () => {
    expect(workflow).not.toMatch(/\$\{\{\s*github\.event\./);
  });

  it("contains no literal account id, zone id or bls hostname (loader is the only source)", () => {
    const dev = selectInstance();
    expect(workflow).not.toContain(dev.account);
    expect(workflow).not.toContain(dev.domain.hostedZoneId);
    expect(workflow).not.toContain(dev.domain.blsDomainName);
  });

  it("has a top-of-file comment block explaining the fleet record, bootstrap prerequisite, docs-only skip and verification", () => {
    const firstJobIdx = workflow.indexOf("\njobs:");
    const header = workflow.slice(0, firstJobIdx);
    const commentLines = header
      .split("\n")
      .filter((line) => line.trim().startsWith("#"));
    expect(commentLines.length).toBeGreaterThan(3);
    expect(header).toMatch(/fleet record/i);
    expect(header).toMatch(/bootstrap/i);
    expect(header).toMatch(/docs-only/i);
    expect(header).toMatch(/verif/i);
  });
});
