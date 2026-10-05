# Edge throttling, reserved concurrency and the in-app limits plumbing (#319, ADR-020 §2,
# §6, §7). geo makes no upstream calls (bundled catalog only), so FEDERAL_MCPS_LIMITS
# carries only the tool-call ceilings and reserved concurrency (question 5's table).

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
    target          = aws_apigatewayv2_stage.default
    override_during = plan
    values          = { invoke_url = "https://test-api-id.execute-api.us-east-1.amazonaws.com/" }
  }
}

variables {
  lambda_zip_path = "./tests/placeholder.zip"
  domain_name     = "geo-mcp.responsive.city"
  hosted_zone_id  = "ZTESTZONE"
  environment_tag = "dev"
}

run "default_edge_and_limits" {
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
    condition     = aws_lambda_function.geo.reserved_concurrent_executions == 5
    error_message = "geo reserved concurrency must default to 5 (ADR-020 §6)"
  }
  assert {
    condition = jsondecode(aws_lambda_function.geo.environment[0].variables["FEDERAL_MCPS_LIMITS"]) == {
      network             = { toolCallsDaily = 1000 }
      pool                = { toolCallsDaily = 10000 }
      reservedConcurrency = 5
    }
    error_message = "FEDERAL_MCPS_LIMITS must default to the spike's question-5 table for geo (tool calls only)"
  }
  assert {
    condition     = aws_lambda_function.geo.environment[0].variables["FEDERAL_MCPS_CALLER_SECRET"] == ""
    error_message = "caller secret must default to empty"
  }
  assert {
    condition     = aws_lambda_function.geo.environment[0].variables["FEDERAL_MCPS_OPERATOR_TOKEN"] == ""
    error_message = "operator bypass token must default to empty"
  }
}

run "fleet_record_override" {
  command = plan

  variables {
    throttling_rate_limit    = 25
    throttling_burst_limit   = 50
    reserved_concurrency     = 3
    network_tool_calls_daily = 2000
    pool_tool_calls_daily    = 20000
    caller_hmac_secret       = "shh"
    operator_bypass_token    = "op-secret"
  }

  assert {
    condition     = aws_lambda_function.geo.reserved_concurrent_executions == 3
    error_message = "an override must change reserved concurrency"
  }
  assert {
    condition = jsondecode(aws_lambda_function.geo.environment[0].variables["FEDERAL_MCPS_LIMITS"]) == {
      network             = { toolCallsDaily = 2000 }
      pool                = { toolCallsDaily = 20000 }
      reservedConcurrency = 3
    }
    error_message = "an override must change FEDERAL_MCPS_LIMITS"
  }
  assert {
    condition     = aws_lambda_function.geo.environment[0].variables["FEDERAL_MCPS_CALLER_SECRET"] == "shh"
    error_message = "the caller secret must ride as FEDERAL_MCPS_CALLER_SECRET"
  }
  assert {
    condition     = aws_lambda_function.geo.environment[0].variables["FEDERAL_MCPS_OPERATOR_TOKEN"] == "op-secret"
    error_message = "the operator bypass token must ride as FEDERAL_MCPS_OPERATOR_TOKEN"
  }
}

# The persistent limiter's table (#322, ADR-020 §2, §10): the admin script creates
# rc-federal-mcps-<env>-limits; the Lambda finds it through FEDERAL_MCPS_LIMITS_TABLE.
run "limits_table_name_from_environment" {
  command = plan

  assert {
    condition     = aws_lambda_function.geo.environment[0].variables["FEDERAL_MCPS_LIMITS_TABLE"] == "rc-federal-mcps-dev-limits"
    error_message = "FEDERAL_MCPS_LIMITS_TABLE must be rc-federal-mcps-<env>-limits"
  }
  assert {
    condition     = output.limits_table_name == "rc-federal-mcps-dev-limits"
    error_message = "the module must output the limits table name it set"
  }
}

run "limits_table_name_follows_the_environment_tag" {
  command = plan

  variables {
    environment_tag = "prod"
  }

  assert {
    condition     = aws_lambda_function.geo.environment[0].variables["FEDERAL_MCPS_LIMITS_TABLE"] == "rc-federal-mcps-prod-limits"
    error_message = "the table name must follow environment_tag"
  }
}
