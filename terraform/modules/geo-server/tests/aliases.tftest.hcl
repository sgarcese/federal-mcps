# Alias hostnames (ADR-016 §2): each alias gets its own certificate, domain name,
# mapping and records, additive to var.domain_name; none are created by default.

mock_provider "aws" {
  override_data {
    target = data.aws_iam_role.exec
    values = { arn = "arn:aws:iam::123456789012:role/rc-geo-mcp-dev-role" }
  }
  override_resource {
    target          = aws_cloudwatch_log_group.lambda
    override_during = plan
    values          = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/rc-geo-mcp-dev" }
  }
  override_resource {
    target          = aws_cloudwatch_log_group.api
    override_during = plan
    values          = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/apigateway/rc-geo-mcp-dev" }
  }
  override_resource {
    target          = aws_apigatewayv2_api.geo
    override_during = plan
    values          = { execution_arn = "arn:aws:execute-api:us-east-1:123456789012:test-api-id" }
  }
  override_resource {
    target          = aws_acm_certificate.geo
    override_during = plan
    values = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id"
      domain_validation_options = [{
        domain_name           = "geo-mcp.responsive.city"
        resource_record_name  = "_acme-challenge.geo-mcp.responsive.city."
        resource_record_type  = "CNAME"
        resource_record_value = "example.acm-validations.aws."
      }]
    }
  }
  override_resource {
    target          = aws_acm_certificate.alias["geo.responsive.city"]
    override_during = plan
    values = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id-alias"
      domain_validation_options = [{
        domain_name           = "geo.responsive.city"
        resource_record_name  = "_acme-challenge.geo.responsive.city."
        resource_record_type  = "CNAME"
        resource_record_value = "example.acm-validations.aws."
      }]
    }
  }
  override_resource {
    target          = aws_apigatewayv2_stage.default
    override_during = plan
    values          = { invoke_url = "https://test-api-id.execute-api.us-east-1.amazonaws.com/" }
  }
}

variables {
  lambda_zip_path    = "./tests/placeholder.zip"
  domain_name        = "geo-mcp.responsive.city"
  alias_domain_names = ["geo.responsive.city"]
  hosted_zone_id     = "ZTESTZONE"
  environment_tag    = "dev"
}

run "an_alias_gets_its_own_certificate_domain_mapping_and_records" {
  command = plan

  assert {
    condition     = aws_acm_certificate.alias["geo.responsive.city"].domain_name == "geo.responsive.city"
    error_message = "the alias must get its own DNS-validated certificate"
  }
  assert {
    condition     = aws_apigatewayv2_domain_name.alias["geo.responsive.city"].domain_name == "geo.responsive.city"
    error_message = "the alias must get its own apigatewayv2 domain name"
  }
  assert {
    condition     = aws_apigatewayv2_api_mapping.alias["geo.responsive.city"].api_id == aws_apigatewayv2_api.geo.id
    error_message = "the alias must map to the same API"
  }
  assert {
    condition     = aws_route53_record.alias_alias_a["geo.responsive.city"].zone_id == "ZTESTZONE" && aws_route53_record.alias_alias_aaaa["geo.responsive.city"].type == "AAAA"
    error_message = "the alias must get A and AAAA alias records in the hosted zone"
  }
  assert {
    condition     = length(aws_route53_record.alias_cert_validation) == 1
    error_message = "one validation record per alias certificate"
  }
}

run "the_primary_domain_is_untouched_by_aliases" {
  command = plan

  assert {
    condition     = aws_acm_certificate.geo.domain_name == "geo-mcp.responsive.city" && aws_apigatewayv2_domain_name.geo.domain_name == "geo-mcp.responsive.city"
    error_message = "adding an alias must not change the primary domain (no destroy/recreate of the live hostname)"
  }
  assert {
    condition     = output.custom_domain_url == "https://geo-mcp.responsive.city/mcp"
    error_message = "custom_domain_url stays the primary hostname"
  }
  assert {
    condition     = output.alias_urls == ["https://geo.responsive.city/mcp"]
    error_message = "alias_urls must list every alias at /mcp"
  }
}

run "no_aliases_by_default" {
  command = plan

  variables {
    alias_domain_names = []
  }

  assert {
    condition     = length(aws_acm_certificate.alias) == 0 && length(aws_apigatewayv2_domain_name.alias) == 0 && length(output.alias_urls) == 0
    error_message = "with no aliases configured, no alias resources may be planned"
  }
}
