# Edge throttling, reserved concurrency and the in-app limits plumbing (#319, ADR-020 §2,
# §6, §7). HUD has no service-wide daily budget — only a per-minute split (ADR-020 §6).

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
    target          = aws_apigatewayv2_stage.default
    override_during = plan
    values          = { invoke_url = "https://test-api-id.execute-api.us-east-1.amazonaws.com/" }
  }
}

variables {
  lambda_zip_path = "./tests/placeholder.zip"
  domain_name     = "hud-user.responsive.city"
  hosted_zone_id  = "ZTESTZONE"
  hud_user_token  = "test-hud-token"
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
    condition     = aws_lambda_function.hud.reserved_concurrent_executions == 2
    error_message = "HUD reserved concurrency must default to 2 (ADR-020 §6)"
  }
  assert {
    condition = jsondecode(aws_lambda_function.hud.environment[0].variables["FEDERAL_MCPS_LIMITS"]) == {
      network             = { upstreamDaily = 1000, toolCallsDaily = 500 }
      pool                = { upstreamDaily = 3000, toolCallsDaily = 5000 }
      upstreamPerMinute   = { hud = 60 }
      reservedConcurrency = 2
    }
    error_message = "FEDERAL_MCPS_LIMITS must default to the spike's question-5 table for HUD (no serviceDaily)"
  }
  assert {
    condition     = aws_lambda_function.hud.environment[0].variables["FEDERAL_MCPS_CALLER_SECRET"] == ""
    error_message = "caller secret must default to empty"
  }
  assert {
    condition     = aws_lambda_function.hud.environment[0].variables["FEDERAL_MCPS_OPERATOR_TOKEN"] == ""
    error_message = "operator bypass token must default to empty"
  }
}

run "fleet_record_override" {
  command = plan

  variables {
    throttling_rate_limit    = 25
    throttling_burst_limit   = 50
    reserved_concurrency     = 4
    network_upstream_daily   = 500
    network_tool_calls_daily = 250
    pool_upstream_daily      = 2000
    pool_tool_calls_daily    = 4000
    upstream_per_minute      = 30
    caller_hmac_secret       = "shh"
    operator_bypass_token    = "op-secret"
  }

  assert {
    condition     = aws_lambda_function.hud.reserved_concurrent_executions == 4
    error_message = "an override must change reserved concurrency"
  }
  assert {
    condition = jsondecode(aws_lambda_function.hud.environment[0].variables["FEDERAL_MCPS_LIMITS"]) == {
      network             = { upstreamDaily = 500, toolCallsDaily = 250 }
      pool                = { upstreamDaily = 2000, toolCallsDaily = 4000 }
      upstreamPerMinute   = { hud = 30 }
      reservedConcurrency = 4
    }
    error_message = "an override must change FEDERAL_MCPS_LIMITS"
  }
  assert {
    condition     = aws_lambda_function.hud.environment[0].variables["FEDERAL_MCPS_CALLER_SECRET"] == "shh"
    error_message = "the caller secret must ride as FEDERAL_MCPS_CALLER_SECRET"
  }
  assert {
    condition     = aws_lambda_function.hud.environment[0].variables["FEDERAL_MCPS_OPERATOR_TOKEN"] == "op-secret"
    error_message = "the operator bypass token must ride as FEDERAL_MCPS_OPERATOR_TOKEN"
  }
}
