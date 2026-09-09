# Offline test of the dev root: the fleet record drives every value (ADR-005 §2).

mock_provider "aws" {
  override_data {
    target = module.github_oidc_deploy_role.data.aws_iam_openid_connect_provider.github
    values = {
      arn = "arn:aws:iam::564762345093:oidc-provider/token.actions.githubusercontent.com"
    }
  }
}

run "fleet_record_drives_the_root" {
  command = plan

  assert {
    condition     = local.instance.name == "dev"
    error_message = "the dev root must select the dev record"
  }

  # The role ARN is computed at apply time; the name is known at plan, so the
  # record's deployRoleArn is checked by rebuilding it from account + role name.
  assert {
    condition = (
      "arn:aws:iam::${local.instance.account}:role/${module.github_oidc_deploy_role.role_name}"
      == local.instance.deployRoleArn
    )
    error_message = "the deploy role name and account must rebuild the fleet record's deployRoleArn"
  }

  assert {
    condition     = output.state_bucket == "federal-mcps-tfstate-${local.instance.account}"
    error_message = "state bucket name must derive from the record's account"
  }

  assert {
    condition     = module.github_oidc_deploy_role.github_subject == "repo:sgarcese@2701478/federal-mcps@1361995308:ref:refs/heads/main"
    error_message = "the root must not override the pinned subject"
  }
}
