# Offline test of the dev root: the fleet record drives every value (ADR-005 §2).

mock_provider "aws" {
  # bls-server's aws_iam_role.exec.arn feeds aws_lambda_function.role, which
  # the AWS provider validates as an ARN client-side even under a mocked
  # provider (terraform/modules/bls-server/tests/bls-server.tftest.hcl has
  # the full explanation); without this override `plan` fails for the whole
  # root, not just bls_server's own resources.
  override_resource {
    target          = module.bls_server.aws_iam_role.exec
    override_during = plan
    values = {
      arn = "arn:aws:iam::564762345093:role/rc-bls-mcp-dev-role"
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
  bls_api_key         = "test-key-value"
}

run "fleet_record_drives_the_root" {
  command = plan

  assert {
    condition     = local.instance.name == "dev"
    error_message = "the dev root must select the dev record"
  }

  assert {
    condition     = output.state_bucket == local.instance.terraform.stateBucket
    error_message = "state bucket must be the fleet record's pre-existing rc-tfstate bucket"
  }
}

run "bls_server_follows_the_rc_naming_pattern" {
  command = plan

  assert {
    condition     = module.bls_server.function_name == "${local.instance.naming.blsService}-${local.instance.environmentTag}"
    error_message = "the BLS function must be named <naming.blsService>-<environmentTag>"
  }
}
