import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { FederalMcpsCiCd } from "../lib/cicd-stack.js";
import { selectInstance } from "../lib/instances.js";

const instance = selectInstance("dev");

function synth(): Template {
  const app = new App();
  const stack = new FederalMcpsCiCd(app, "FederalMcpsCiCd", {
    instance,
    env: { account: instance.account, region: instance.region },
  });
  return Template.fromStack(stack);
}

const GITHUB_SUBJECT = "repo:sgarcese@2701478/federal-mcps@1361995308:ref:refs/heads/main";

describe("FederalMcpsCiCd", () => {
  it("creates the github-deploy role with the expected OIDC trust policy", () => {
    const template = synth();
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "federal-mcps-github-deploy",
      MaxSessionDuration: 3600,
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: "Allow",
            Action: "sts:AssumeRoleWithWebIdentity",
            Principal: {
              Federated: `arn:aws:iam::${instance.account}:oidc-provider/token.actions.githubusercontent.com`,
            },
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              },
              StringLike: {
                "token.actions.githubusercontent.com:sub": GITHUB_SUBJECT,
              },
            },
          },
        ],
      },
    });
  });

  it("does not create an OIDC provider (it is an account singleton referenced elsewhere)", () => {
    const template = synth();
    template.resourceCountIs("AWS::IAM::OIDCProvider", 0);
  });

  it("scopes the assume-role statement to the account's cdk execution roles", () => {
    const template = synth();
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: "sts:AssumeRole",
            Resource: `arn:aws:iam::${instance.account}:role/cdk-*`,
          }),
        ]),
      },
    });
  });

  it("scopes the read-only verification statement to FederalMcps resources", () => {
    const template = synth();
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: [
              "cloudformation:DescribeStackResource",
              "cloudformation:ListStackResources",
              "lambda:GetFunctionConfiguration",
            ],
            Resource: [
              `arn:aws:cloudformation:${instance.region}:${instance.account}:stack/FederalMcps*/*`,
              `arn:aws:lambda:${instance.region}:${instance.account}:function:FederalMcps*`,
            ],
          }),
        ]),
      },
    });
  });

  it("grants no actions beyond the documented set", () => {
    const template = synth();
    const policies = template.findResources("AWS::IAM::Policy");
    const values = Object.values(policies) as Array<{
      Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[] }> } };
    }>;
    expect(values).toHaveLength(1);
    const statements = values[0]?.Properties.PolicyDocument.Statement ?? [];
    const actions = statements
      .flatMap((statement) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action],
      )
      .sort();
    expect(actions).toEqual(
      [
        "sts:AssumeRole",
        "cloudformation:DescribeStackResource",
        "cloudformation:ListStackResources",
        "lambda:GetFunctionConfiguration",
      ].sort(),
    );
  });

  it("outputs DeployRoleArn matching the instance record", () => {
    const template = synth();
    template.hasOutput("DeployRoleArn", {
      Value: instance.deployRoleArn,
    });
  });

  it("tags every resource with environment and project", () => {
    const template = synth();
    template.hasResourceProperties("AWS::IAM::Role", {
      Tags: Match.arrayWith([
        { Key: "environment", Value: instance.environmentTag },
        { Key: "project", Value: "federal-mcps" },
      ]),
    });
  });
});
