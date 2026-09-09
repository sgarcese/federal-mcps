# terraform test — runs offline with a mocked aws provider (ADR-005 §2).

mock_provider "aws" {
  override_data {
    target = data.aws_iam_openid_connect_provider.github
    values = {
      arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    }
  }
}

variables {
  account_id     = "123456789012"
  region         = "us-east-1"
  state_bucket   = "rc-tfstate-123456789012"
  hosted_zone_id = "ZTESTZONE"
}

run "trust_policy_is_pinned_to_this_repo_main_branch" {
  command = plan

  assert {
    condition     = aws_iam_role.deploy.name == "rc-federal-mcps-github-deploy"
    error_message = "role name must match the instance record's deployRoleArn"
  }

  assert {
    condition     = aws_iam_role.deploy.max_session_duration == 3600
    error_message = "sessions must be limited to one hour"
  }

  assert {
    condition = (
      jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    )
    error_message = "trust must require the sts.amazonaws.com audience"
  }

  assert {
    condition = (
      jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringLike["token.actions.githubusercontent.com:sub"]
      == "repo:sgarcese@2701478/federal-mcps@1361995308:ref:refs/heads/main"
    )
    error_message = "trust must be pinned to the ID-qualified subject for main"
  }

  assert {
    condition     = jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Action == "sts:AssumeRoleWithWebIdentity"
    error_message = "trust must use AssumeRoleWithWebIdentity"
  }

  assert {
    condition     = output.github_subject == "repo:sgarcese@2701478/federal-mcps@1361995308:ref:refs/heads/main"
    error_message = "github_subject output must expose the pinned subject"
  }
}

run "permissions_stay_inside_the_documented_set" {
  command = plan

  # Every action in the policy must belong to one of these service namespaces.
  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.deploy.policy).Statement : alltrue([
        for action in statement.Action :
        contains(["s3", "iam", "lambda", "logs", "apigateway", "acm", "route53"], split(":", action)[0])
      ])
    ])
    error_message = "deploy policy contains an action outside the documented service set"
  }

  # No statement may grant iam:* or a wildcard action.
  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.deploy.policy).Statement : alltrue([
        for action in statement.Action :
        !endswith(action, ":*") && action != "*"
      ])
    ])
    error_message = "deploy policy must not grant wildcard actions"
  }

  # IAM role management is confined to the rc- prefix (ADR-006 §2).
  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.deploy.policy).Statement :
      statement.Sid != "ManagePrefixedRoles" ||
      alltrue([for r in statement.Resource : endswith(r, ":role/rc-*")])
    ])
    error_message = "role management must be scoped to rc-* roles"
  }

  # No secrets service at all: keys ride as Terraform variables (ADR-006 §3).
  assert {
    condition = !anytrue([
      for statement in jsondecode(aws_iam_role_policy.deploy.policy).Statement : anytrue([
        for action in statement.Action :
        startswith(action, "secretsmanager:")
      ])
    ])
    error_message = "the deploy role must not touch Secrets Manager"
  }
}
