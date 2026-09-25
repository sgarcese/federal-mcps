# Alias hostnames (ADR-016 §2): each alias gets its own certificate, domain name,
# mapping and records, additive to var.domain_name; none are created by default.

mock_provider "aws" {
  override_data {
    target = data.aws_iam_role.exec
    values = { arn = "arn:aws:iam::123456789012:role/rc-huduser-mcp-dev-role" }
  }
  override_resource {
    target          = aws_cloudwatch_log_group.lambda
    override_during = plan
    values          = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/rc-huduser-mcp-dev" }
  }
  override_resource {
    target          = aws_cloudwatch_log_group.api
    override_during = plan
    values          = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/apigateway/rc-huduser-mcp-dev" }
  }
  override_resource {
    target          = aws_apigatewayv2_api.hud
    override_during = plan
    values          = { execution_arn = "arn:aws:execute-api:us-east-1:123456789012:test-api-id" }
  }
  override_resource {
    target          = aws_acm_certificate.hud
    override_during = plan
    values = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id"
      domain_validation_options = [{
        domain_name           = "hud-user.responsive.city"
        resource_record_name  = "_acme-challenge.hud-user.responsive.city."
        resource_record_type  = "CNAME"
        resource_record_value = "example.acm-validations.aws."
      }]
    }
  }
  override_resource {
    target          = aws_acm_certificate.alias["hud.responsive.city"]
    override_during = plan
    values = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id-alias"
      domain_validation_options = [{
        domain_name           = "hud.responsive.city"
        resource_record_name  = "_acme-challenge.hud.responsive.city."
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
  domain_name        = "hud-user.responsive.city"
  alias_domain_names = ["hud.responsive.city"]
  hosted_zone_id     = "ZTESTZONE"
  environment_tag    = "dev"
  hud_user_token     = "test-hud-token"
}

run "an_alias_gets_its_own_certificate_domain_mapping_and_records" {
  command = plan

  assert {
    condition     = aws_acm_certificate.alias["hud.responsive.city"].domain_name == "hud.responsive.city"
    error_message = "the alias must get its own DNS-validated certificate"
  }
  assert {
    condition     = aws_apigatewayv2_domain_name.alias["hud.responsive.city"].domain_name == "hud.responsive.city"
    error_message = "the alias must get its own apigatewayv2 domain name"
  }
  assert {
    condition     = aws_apigatewayv2_api_mapping.alias["hud.responsive.city"].api_id == aws_apigatewayv2_api.hud.id
    error_message = "the alias must map to the same API"
  }
  assert {
    condition     = aws_route53_record.alias_alias_a["hud.responsive.city"].zone_id == "ZTESTZONE" && aws_route53_record.alias_alias_aaaa["hud.responsive.city"].type == "AAAA"
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
    condition     = aws_acm_certificate.hud.domain_name == "hud-user.responsive.city" && aws_apigatewayv2_domain_name.hud.domain_name == "hud-user.responsive.city"
    error_message = "adding an alias must not change the primary domain (no destroy/recreate of the live hostname)"
  }
  assert {
    condition     = output.custom_domain_url == "https://hud-user.responsive.city/mcp"
    error_message = "custom_domain_url stays the primary hostname"
  }
  assert {
    condition     = output.alias_urls == ["https://hud.responsive.city/mcp"]
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
