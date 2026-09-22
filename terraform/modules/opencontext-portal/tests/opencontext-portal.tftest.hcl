# terraform test — offline, mocked aws provider (ADR-005 §2). The OpenContext portal
# module (ADR-016 §5) differs from the agency modules in runtime and configuration:
# a Python Lambda whose whole configuration is one OPENCONTEXT_CONFIG JSON variable.

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

run "python_lambda_on_x86_with_the_opencontext_handler" {
  command = plan

  assert {
    condition     = aws_lambda_function.portal.function_name == "rc-cdc-mcp-dev"
    error_message = "function name must be <service_name>-<environment_tag>"
  }
  assert {
    condition     = aws_lambda_function.portal.runtime == "python3.11" && aws_lambda_function.portal.architectures[0] == "x86_64"
    error_message = "runtime must be python3.11 on x86_64 (matches the wheels bundle-opencontext.sh installs)"
  }
  assert {
    condition     = aws_lambda_function.portal.handler == "server.adapters.aws_lambda.lambda_handler"
    error_message = "handler must be OpenContext's Lambda adapter"
  }
  assert {
    condition     = aws_lambda_function.portal.timeout == 29 && aws_lambda_function.portal.memory_size == 512
    error_message = "timeout must stay under the HTTP API's 30s and memory default to 512"
  }
  assert {
    condition     = aws_lambda_function.portal.tracing_config[0].mode == "Active"
    error_message = "X-Ray tracing must be Active"
  }
}

run "config_enables_exactly_the_portal_plugin_with_no_token_by_default" {
  command = plan

  assert {
    condition     = jsondecode(aws_lambda_function.portal.environment[0].variables["OPENCONTEXT_CONFIG"]).plugins.socrata.enabled == true
    error_message = "OPENCONTEXT_CONFIG must enable the socrata plugin"
  }
  assert {
    condition     = jsondecode(aws_lambda_function.portal.environment[0].variables["OPENCONTEXT_CONFIG"]).plugins.socrata.portal_url == "https://data.cdc.gov" && jsondecode(aws_lambda_function.portal.environment[0].variables["OPENCONTEXT_CONFIG"]).plugins.socrata.base_url == "https://data.cdc.gov"
    error_message = "the socrata plugin must carry portal_url and base_url"
  }
  assert {
    condition     = !contains(keys(jsondecode(aws_lambda_function.portal.environment[0].variables["OPENCONTEXT_CONFIG"]).plugins.socrata), "app_token")
    error_message = "no app_token key when none is given (the plugin treats absence as no token)"
  }
  assert {
    condition     = length(keys(jsondecode(aws_lambda_function.portal.environment[0].variables["OPENCONTEXT_CONFIG"]).plugins)) == 1
    error_message = "OpenContext enforces one plugin per server; exactly one must be configured"
  }
  assert {
    condition     = jsondecode(aws_lambda_function.portal.environment[0].variables["OPENCONTEXT_CONFIG"]).server_name == "CDC Open Data MCP" && jsondecode(aws_lambda_function.portal.environment[0].variables["OPENCONTEXT_CONFIG"]).organization == "CDC"
    error_message = "server_name and organization derive from display_name"
  }
  assert {
    condition     = !contains(keys(aws_lambda_function.portal.environment[0].variables), "BLS_API_KEY") && !contains(keys(aws_lambda_function.portal.environment[0].variables), "CENSUS_API_KEY")
    error_message = "a portal Lambda carries no agency API key"
  }
}

run "a_token_travels_inside_the_config_when_given" {
  command = plan

  variables {
    app_token = "test-socrata-token"
  }

  assert {
    condition     = jsondecode(aws_lambda_function.portal.environment[0].variables["OPENCONTEXT_CONFIG"]).plugins.socrata.app_token == "test-socrata-token"
    error_message = "the token must be set on the socrata plugin section"
  }
}

run "an_arcgis_portal_takes_portal_url_only" {
  command = plan

  variables {
    portal_type = "arcgis"
    portal_url  = "https://hudgis-hud.opendata.arcgis.com"
  }

  assert {
    condition     = jsondecode(aws_lambda_function.portal.environment[0].variables["OPENCONTEXT_CONFIG"]).plugins.arcgis.enabled == true && !contains(keys(jsondecode(aws_lambda_function.portal.environment[0].variables["OPENCONTEXT_CONFIG"]).plugins.arcgis), "base_url")
    error_message = "the arcgis plugin section must not carry base_url"
  }
}

run "lambda_uses_the_admin_provisioned_execution_role" {
  command = plan

  assert {
    condition     = data.aws_iam_role.exec.name == "rc-cdc-mcp-dev-role" && aws_lambda_function.portal.role == data.aws_iam_role.exec.arn
    error_message = "the Lambda must use the <function_name>-role execution role (ADR-007)"
  }
}

run "http_api_and_domain_match_the_agency_modules" {
  command = plan

  assert {
    condition     = aws_apigatewayv2_route.post_mcp.route_key == "POST /mcp" && aws_apigatewayv2_route.get_mcp.route_key == "GET /mcp"
    error_message = "must route POST and GET /mcp to the integration"
  }
  assert {
    condition     = aws_apigatewayv2_integration.portal.payload_format_version == "2.0"
    error_message = "integration must use payload format 2.0"
  }
  assert {
    condition     = aws_acm_certificate.portal.domain_name == "cdc.responsive.city" && aws_apigatewayv2_domain_name.portal.domain_name_configuration[0].security_policy == "TLS_1_2"
    error_message = "certificate and domain must equal var.domain_name with TLS 1.2"
  }
  assert {
    condition     = output.custom_domain_url == "https://cdc.responsive.city/mcp" && can(regex("/mcp$", output.invoke_url))
    error_message = "outputs must point at /mcp"
  }
  assert {
    condition     = length(output.alias_urls) == 0
    error_message = "no aliases by default"
  }
}
