# Public-use protection wiring (#319, ADR-020 §2, §6, §7): proves the dev root actually reads
# the fleet record's `limits` block and feeds it into every module's throttling, reserved
# concurrency and FEDERAL_MCPS_LIMITS variables — the per-module default/override behaviour
# itself is asserted in each module's own tests/limits.tftest.hcl.

mock_provider "aws" {
  override_data {
    target = module.bls_server.data.aws_iam_role.exec
    values = { arn = "arn:aws:iam::123456789012:role/rc-bls-mcp-dev-role" }
  }
  override_data {
    target = module.geo_server.data.aws_iam_role.exec
    values = { arn = "arn:aws:iam::123456789012:role/rc-geo-mcp-dev-role" }
  }
  override_data {
    target = module.cdc_portal.data.aws_iam_role.exec
    values = { arn = "arn:aws:iam::123456789012:role/rc-cdc-mcp-dev-role" }
  }
  override_data {
    target = module.census_server.data.aws_iam_role.exec
    values = { arn = "arn:aws:iam::123456789012:role/rc-census-mcp-dev-role" }
  }
  override_data {
    target = module.hud_server.data.aws_iam_role.exec
    values = { arn = "arn:aws:iam::123456789012:role/rc-huduser-mcp-dev-role" }
  }
  override_data {
    target = module.bea_server.data.aws_iam_role.exec
    values = { arn = "arn:aws:iam::123456789012:role/rc-bea-mcp-dev-role" }
  }

  override_resource {
    target          = module.bls_server.aws_acm_certificate.bls
    override_during = plan
    values = {
      arn                       = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id"
      domain_validation_options = [{ domain_name = "bls-mcp.responsive.city", resource_record_name = "_acme-challenge.bls-mcp.responsive.city.", resource_record_type = "CNAME", resource_record_value = "example.acm-validations.aws." }]
    }
  }
  override_resource {
    target          = module.census_server.aws_acm_certificate.census
    override_during = plan
    values = {
      arn                       = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id-census"
      domain_validation_options = [{ domain_name = "census-mcp.responsive.city", resource_record_name = "_acme-challenge.census-mcp.responsive.city.", resource_record_type = "CNAME", resource_record_value = "example.acm-validations.aws." }]
    }
  }
  override_resource {
    target          = module.geo_server.aws_acm_certificate.geo
    override_during = plan
    values = {
      arn                       = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id-geo"
      domain_validation_options = [{ domain_name = "geo-mcp.responsive.city", resource_record_name = "_acme-challenge.geo-mcp.responsive.city.", resource_record_type = "CNAME", resource_record_value = "example.acm-validations.aws." }]
    }
  }
  override_resource {
    target          = module.cdc_portal.aws_acm_certificate.portal
    override_during = plan
    values = {
      arn                       = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id-cdc"
      domain_validation_options = [{ domain_name = "cdc.responsive.city", resource_record_name = "_acme-challenge.cdc.responsive.city.", resource_record_type = "CNAME", resource_record_value = "example.acm-validations.aws." }]
    }
  }
  override_resource {
    target          = module.hud_server.aws_acm_certificate.hud
    override_during = plan
    values = {
      arn                       = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id-hud"
      domain_validation_options = [{ domain_name = "hud-user.responsive.city", resource_record_name = "_acme-challenge.hud-user.responsive.city.", resource_record_type = "CNAME", resource_record_value = "example.acm-validations.aws." }]
    }
  }
  override_resource {
    target          = module.bea_server.aws_acm_certificate.bea
    override_during = plan
    values = {
      arn                       = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id-bea"
      domain_validation_options = [{ domain_name = "bea.responsive.city", resource_record_name = "_acme-challenge.bea.responsive.city.", resource_record_type = "CNAME", resource_record_value = "example.acm-validations.aws." }]
    }
  }

  # ADR-016 §2 aliases: instances.example.json configures these for bls/geo/census; the alias
  # certificate's domain_validation_options is only known to the real provider.
  override_resource {
    target          = module.bls_server.aws_acm_certificate.alias["bls.responsive.city"]
    override_during = plan
    values = {
      arn                       = "arn:aws:acm:us-east-1:123456789012:certificate/alias-bls"
      domain_validation_options = [{ domain_name = "bls.responsive.city", resource_record_name = "_acme-challenge.bls.responsive.city.", resource_record_type = "CNAME", resource_record_value = "example.acm-validations.aws." }]
    }
  }
  override_resource {
    target          = module.geo_server.aws_acm_certificate.alias["geo.responsive.city"]
    override_during = plan
    values = {
      arn                       = "arn:aws:acm:us-east-1:123456789012:certificate/alias-geo"
      domain_validation_options = [{ domain_name = "geo.responsive.city", resource_record_name = "_acme-challenge.geo.responsive.city.", resource_record_type = "CNAME", resource_record_value = "example.acm-validations.aws." }]
    }
  }
  override_resource {
    target          = module.census_server.aws_acm_certificate.alias["census.responsive.city"]
    override_during = plan
    values = {
      arn                       = "arn:aws:acm:us-east-1:123456789012:certificate/alias-census"
      domain_validation_options = [{ domain_name = "census.responsive.city", resource_record_name = "_acme-challenge.census.responsive.city.", resource_record_type = "CNAME", resource_record_value = "example.acm-validations.aws." }]
    }
  }
}

variables {
  bls_lambda_zip_path         = "../../modules/bls-server/tests/placeholder.zip"
  geo_lambda_zip_path         = "../../modules/geo-server/tests/placeholder.zip"
  census_lambda_zip_path      = "../../modules/census-server/tests/placeholder.zip"
  hud_lambda_zip_path         = "../../modules/hud-server/tests/placeholder.zip"
  bea_lambda_zip_path         = "../../modules/bea-server/tests/placeholder.zip"
  opencontext_lambda_zip_path = "../../modules/opencontext-portal/tests/placeholder.zip"
  bls_api_key                 = "test-key-value"
  census_api_key              = "test-census-key"
  hud_user_token              = "test-hud-token"
  bea_api_key                 = "test-bea-key"
}

run "default_fleet_record_wires_module_defaults" {
  command = plan

  assert {
    condition     = module.bls_server.function_name == "rc-bls-mcp-dev"
    error_message = "sanity: bls module must still plan"
  }
  assert {
    condition     = jsondecode(module.bls_server.lambda_limits_json).reservedConcurrency == 5
    error_message = "instances.example.json's limits.bls.reservedConcurrency (5) must reach the module"
  }
  assert {
    condition     = jsondecode(module.hud_server.lambda_limits_json).upstreamPerMinute.hud == 60
    error_message = "instances.example.json's limits.hud.upstreamPerMinute (60) must reach the module"
  }
  assert {
    condition     = can(module.cdc_portal.lambda_config_json) && true
    error_message = "sanity: cdc module must still plan"
  }
}

run "fleet_record_override_wires_through_to_the_modules" {
  command = plan

  variables {
    fleet_path_override = "./tests/fixture-limits-override.json"
  }

  assert {
    condition     = jsondecode(module.bls_server.lambda_limits_json).reservedConcurrency == 7
    error_message = "the fixture's limits.bls.reservedConcurrency (7) must override the module default"
  }
  assert {
    condition     = jsondecode(module.bls_server.lambda_limits_json).serviceDaily.bls == 400
    error_message = "the fixture's limits.bls.serviceDaily (400) must override the module default"
  }
  assert {
    condition     = jsondecode(module.hud_server.lambda_limits_json).upstreamPerMinute.hud == 30
    error_message = "the fixture's limits.hud.upstreamPerMinute (30) must override the module default"
  }
}
