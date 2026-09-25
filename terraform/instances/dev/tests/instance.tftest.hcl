# Offline test of the dev root: the fleet record drives every value (ADR-005 §2).

mock_provider "aws" {
  # bls-server reads its admin-provisioned execution role by data source (ADR-007);
  # its arn feeds aws_lambda_function.role, which the AWS provider validates as an
  # ARN client-side even under a mocked provider, so `plan` needs this value.
  override_data {
    target = module.bls_server.data.aws_iam_role.exec
    values = {
      arn = "arn:aws:iam::123456789012:role/rc-bls-mcp-dev-role"
    }
  }

  override_data {
    target = module.geo_server.data.aws_iam_role.exec
    values = {
      arn = "arn:aws:iam::123456789012:role/rc-geo-mcp-dev-role"
    }
  }

  override_data {
    target = module.cdc_portal.data.aws_iam_role.exec
    values = {
      arn = "arn:aws:iam::123456789012:role/rc-cdc-mcp-dev-role"
    }
  }

  override_data {
    target = module.census_server.data.aws_iam_role.exec
    values = {
      arn = "arn:aws:iam::123456789012:role/rc-census-mcp-dev-role"
    }
  }

  override_data {
    target = module.hud_server.data.aws_iam_role.exec
    values = {
      arn = "arn:aws:iam::123456789012:role/rc-huduser-mcp-dev-role"
    }
  }

  # aws_acm_certificate.domain_validation_options's element count is only
  # known to the real provider (one per SAN); aws_route53_record.cert_validation
  # for_each's over it, which fails `plan` under the mocked provider without this.
  override_resource {
    target          = module.bls_server.aws_acm_certificate.bls
    override_during = plan
    values = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id"
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

  override_resource {
    target          = module.census_server.aws_acm_certificate.census
    override_during = plan
    values = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id-census"
      domain_validation_options = [
        {
          domain_name           = "census-mcp.responsive.city"
          resource_record_name  = "_acme-challenge.census-mcp.responsive.city."
          resource_record_type  = "CNAME"
          resource_record_value = "example.acm-validations.aws."
        },
      ]
    }
  }

  override_resource {
    target          = module.geo_server.aws_acm_certificate.geo
    override_during = plan
    values = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id-geo"
      domain_validation_options = [
        {
          domain_name           = "geo-mcp.responsive.city"
          resource_record_name  = "_acme-challenge.geo-mcp.responsive.city."
          resource_record_type  = "CNAME"
          resource_record_value = "example.acm-validations.aws."
        },
      ]
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

  # ADR-016 §2 aliases: one certificate per alias hostname from the fleet record.
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
  # bls-server's lambda_zip_path needs a real file for filebase64sha256;
  # the module's own committed placeholder stands in so this root's tests
  # don't depend on `npm run bundle` having run first (CI creates the real
  # placeholder for `terraform validate`; see .github/workflows/ci.yml).
  bls_lambda_zip_path         = "../../modules/bls-server/tests/placeholder.zip"
  geo_lambda_zip_path         = "../../modules/geo-server/tests/placeholder.zip"
  census_lambda_zip_path      = "../../modules/census-server/tests/placeholder.zip"
  hud_lambda_zip_path         = "../../modules/hud-server/tests/placeholder.zip"
  opencontext_lambda_zip_path = "../../modules/opencontext-portal/tests/placeholder.zip"
  bls_api_key                 = "test-key-value"
  census_api_key              = "test-census-key"
  hud_user_token              = "test-hud-token"
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

run "geo_server_follows_the_rc_naming_pattern_and_records_its_domain" {
  command = plan

  assert {
    condition     = module.geo_server.function_name == "${local.instance.naming.geoService}-${local.instance.environmentTag}"
    error_message = "the geo function must be named <naming.geoService>-<environmentTag>"
  }

  # The exact geo hostname is pinned here (a .tftest.hcl, excluded from the literal
  # scan) rather than in a scanned source file.
  assert {
    condition     = local.instance.naming.geoService == "rc-geo-mcp"
    error_message = "the geo service must be rc-geo-mcp"
  }

  assert {
    condition     = output.geo_custom_domain_url == "https://geo-mcp.responsive.city/mcp"
    error_message = "geo_custom_domain_url must be https://<domain.geoDomainName>/mcp"
  }
}

run "short_hostnames_are_served_as_aliases_of_the_live_domains" {
  command = plan

  assert {
    condition     = output.bls_alias_urls == ["https://bls.responsive.city/mcp"] && output.geo_alias_urls == ["https://geo.responsive.city/mcp"] && output.census_alias_urls == ["https://census.responsive.city/mcp"]
    error_message = "each server must serve its short <service>.responsive.city alias from the fleet record (ADR-016 §2)"
  }

  assert {
    condition     = output.bls_custom_domain_url == "https://bls-mcp.responsive.city/mcp"
    error_message = "the primary domain must stay bls-mcp.responsive.city (aliases are additive)"
  }
}

run "hud_server_follows_the_rc_naming_pattern_and_records_its_domain" {
  command = plan

  assert {
    condition     = module.hud_server.function_name == "rc-huduser-mcp-dev"
    error_message = "the HUD function must be named rc-huduser-mcp-dev"
  }

  assert {
    condition     = output.hud_custom_domain_url == "https://hud-user.responsive.city/mcp"
    error_message = "hud_custom_domain_url must be https://<domain.hudDomainName>/mcp"
  }
}

run "cdc_portal_is_an_opencontext_socrata_lambda_on_the_short_hostname" {
  command = plan

  assert {
    condition     = module.cdc_portal.function_name == "${local.instance.naming.cdcService}-${local.instance.environmentTag}"
    error_message = "the CDC portal function must be named <naming.cdcService>-<environmentTag>"
  }

  assert {
    condition     = output.cdc_custom_domain_url == "https://cdc.responsive.city/mcp"
    error_message = "cdc_custom_domain_url must be https://<domain.cdcDomainName>/mcp"
  }

  assert {
    condition     = jsondecode(module.cdc_portal.lambda_config_json).plugins.socrata.portal_url == "https://data.cdc.gov"
    error_message = "the portal must point at data.cdc.gov"
  }
}
