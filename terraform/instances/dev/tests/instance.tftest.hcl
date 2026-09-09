# Offline test of the dev root: the fleet record drives every value (ADR-005 §2).

mock_provider "aws" {
  override_data {
    target = module.github_oidc_deploy_role.data.aws_iam_openid_connect_provider.github
    values = {
      arn = "arn:aws:iam::564762345093:oidc-provider/token.actions.githubusercontent.com"
    }
  }

  override_data {
    target = module.bls_server.data.aws_secretsmanager_secret.bls
    values = {
      arn = "arn:aws:secretsmanager:us-east-1:564762345093:secret:federal-mcps/dev/bls-AbCdEf"
    }
  }

  # bls-server's aws_iam_role.exec.arn feeds aws_lambda_function.role, which
  # the AWS provider validates as an ARN client-side even under a mocked
  # provider (terraform/modules/bls-server/tests/bls-server.tftest.hcl has
  # the full explanation); without this override `plan` fails for the whole
  # root, not just bls_server's own resources.
  override_resource {
    target          = module.bls_server.aws_iam_role.exec
    override_during = plan
    values = {
      arn = "arn:aws:iam::564762345093:role/federal-mcps-bls-exec"
    }
  }

  # aws_acm_certificate.domain_validation_options's element count is only
  # known to the real provider (one per SAN); aws_route53_record.cert_validation
  # for_each's over it, which fails `plan` under the mocked provider without this.
  override_resource {
    target          = module.bls_server.aws_acm_certificate.bls
    override_during = plan
    values = {
      arn = "arn:aws:acm:us-east-1:564762345093:certificate/test-cert-id"
      domain_validation_options = [
        {
          domain_name           = "bls-mcp.responsive.city"
          resource_record_name  = "_acme-challenge.bls-mcp.responsive.city."
          resource_record_type  = "CNAME"
          resource_record_value = "example.acm-validations.aws."
        },
      ]
    }
  }
}

variables {
  # bls-server's lambda_zip_path needs a real file for filebase64sha256;
  # the module's own committed placeholder stands in so this root's tests
  # don't depend on `npm run bundle` having run first (CI creates the real
  # placeholder for `terraform validate`; see .github/workflows/ci.yml).
  bls_lambda_zip_path = "../../modules/bls-server/tests/placeholder.zip"
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
