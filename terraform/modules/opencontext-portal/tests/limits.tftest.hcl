# Edge throttling and reserved concurrency only (#319, ADR-020 §2, §6): the CDC portal
# gets no FEDERAL_MCPS_LIMITS — core's in-app limiter does not reach OpenContext — so no
# secrets or limits JSON ride on this Lambda, only the edge layer.

mock_provider "aws" {
  override_data {
    target = data.aws_iam_role.exec
    values = { arn = "arn:aws:iam::123456789012:role/rc-cdc-mcp-dev-role" }
  }
  override_resource {
    target          = aws_cloudwatch_log_group.lambda
    override_during = plan
    values          = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/rc-cdc-mcp-dev" }
  }
  override_resource {
    target          = aws_cloudwatch_log_group.api
    override_during = plan
    values          = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/apigateway/rc-cdc-mcp-dev" }
  }
  override_resource {
    target          = aws_apigatewayv2_api.portal
    override_during = plan
    values          = { execution_arn = "arn:aws:execute-api:us-east-1:123456789012:test-api-id" }
  }
  override_resource {
    target          = aws_acm_certificate.portal
    override_during = plan
    values = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id"
      domain_validation_options = [{
        domain_name           = "cdc.responsive.city"
        resource_record_name  = "_acme-challenge.cdc.responsive.city."
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
  service_name    = "rc-cdc-mcp"
  display_name    = "CDC"
  portal_type     = "socrata"
  portal_url      = "https://data.cdc.gov"
  lambda_zip_path = "./tests/placeholder.zip"
  domain_name     = "cdc.responsive.city"
  hosted_zone_id  = "ZTESTZONE"
  environment_tag = "dev"
}

run "default_edge_layer" {
  command = plan

  assert {
    condition     = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_rate_limit == 10
    error_message = "stage throttling rate must default to 10 req/s (ADR-020 §6)"
  }
  assert {
    condition     = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_burst_limit == 20
    error_message = "stage throttling burst must default to 20 (ADR-020 §6)"
  }
  assert {
    condition     = aws_lambda_function.portal.reserved_concurrent_executions == 5
    error_message = "CDC portal reserved concurrency must default to 5 (ADR-020 §6)"
  }
  assert {
    condition     = !contains(keys(aws_lambda_function.portal.environment[0].variables), "FEDERAL_MCPS_LIMITS")
    error_message = "the CDC portal gets no FEDERAL_MCPS_LIMITS (edge only, ADR-020 §2)"
  }
}

run "fleet_record_override" {
  command = plan

  variables {
    throttling_rate_limit  = 25
    throttling_burst_limit = 50
    reserved_concurrency   = 3
  }

  assert {
    condition     = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_rate_limit == 25
    error_message = "an override must change the stage throttling rate"
  }
  assert {
    condition     = aws_lambda_function.portal.reserved_concurrent_executions == 3
    error_message = "an override must change reserved concurrency"
  }
}
