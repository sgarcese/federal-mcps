/**
 * `FederalMcpsCiCd` (ADR-004 §2): the GitHub OIDC deploy role for this
 * repository. Deployed exactly once, by a person with `AWS_PROFILE=rc-deploy`
 * (see `docs/runbooks/bootstrap-instance.md`) — every later deploy is CI
 * assuming the role this stack creates.
 */

import { CfnOutput, Duration, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import type { InstanceRecord } from "./instances.js";

export interface FederalMcpsCiCdProps extends StackProps {
  readonly instance: InstanceRecord;
}

/**
 * Immutable across repository renames (ADR-004 §2): GitHub's OIDC subject is
 * qualified by the numeric org and repo IDs, not their current names.
 */
const GITHUB_SUBJECT = "repo:sgarcese@2701478/federal-mcps@1361995308:ref:refs/heads/main";

const ROLE_NAME = "federal-mcps-github-deploy";

export class FederalMcpsCiCd extends Stack {
  constructor(scope: Construct, id: string, props: FederalMcpsCiCdProps) {
    super(scope, id, props);

    const { instance } = props;
    const { account, region } = instance;

    // Referenced, not created: the OIDC provider is an account singleton
    // already registered by a sibling deployment (ADR-004 context).
    const oidcProviderArn = `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`;

    const role = new iam.Role(this, "GitHubDeployRole", {
      roleName: ROLE_NAME,
      assumedBy: new iam.WebIdentityPrincipal(oidcProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": GITHUB_SUBJECT,
        },
      }),
      maxSessionDuration: Duration.hours(1),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "AssumeCdkExecutionRoles",
        effect: iam.Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${account}:role/cdk-*`],
      }),
    );

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "PostDeployVerificationReadOnly",
        effect: iam.Effect.ALLOW,
        actions: [
          "cloudformation:DescribeStackResource",
          "cloudformation:ListStackResources",
          "lambda:GetFunctionConfiguration",
        ],
        resources: [
          `arn:aws:cloudformation:${region}:${account}:stack/FederalMcps*/*`,
          `arn:aws:lambda:${region}:${account}:function:FederalMcps*`,
        ],
      }),
    );

    Tags.of(this).add("environment", instance.environmentTag);
    Tags.of(this).add("project", "federal-mcps");

    new CfnOutput(this, "DeployRoleArn", {
      value: `arn:aws:iam::${account}:role/${ROLE_NAME}`,
      description: "IAM role GitHub Actions assumes via OIDC to deploy federal-mcps.",
    });
  }
}
