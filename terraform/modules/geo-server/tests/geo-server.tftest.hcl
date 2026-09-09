# terraform test — runs offline with a mocked aws provider (ADR-005 §2).
#
# The geography server module mirrors bls-server (a separate copy, so the live BLS
# infrastructure is untouched), differing only in what the Lambda carries: the catalog
# is a file baked into the zip (ADR-008 §7), so this Lambda has no agency API key — it
# sets GEO_CATALOG_PATH, pointing at the bundled catalog, instead of BLS_API_KEY.
#
# `lambda_zip_path` points at the committed placeholder zip (tests/placeholder.zip) so
# `filebase64sha256` has a real file to hash without needing `npm run bundle` first.

mock_provider "aws" {
  override_data {
    target = data.aws_iam_role.exec
    values = {
      arn = "arn:aws:iam::123456789012:role/rc-geo-mcp-dev-role"
    }
  }

  override_resource {
    target          = aws_cloudwatch_log_group.lambda
    override_during = plan
    values = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/rc-geo-mcp-dev"
    }
  }

  override_resource {
    target          = aws_cloudwatch_log_group.api
    override_during = plan
    values = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/apigateway/rc-geo-mcp-dev"
    }
  }

  override_resource {
    target          = aws_apigatewayv2_api.geo
    override_during = plan
    values = {
      execution_arn = "arn:aws:execute-api:us-east-1:123456789012:test-api-id"
    }
  }

  override_resource {
    target          = aws_acm_certificate.geo
    override_during = plan
    values = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id"
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
    target          = aws_apigatewayv2_stage.default
    override_during = plan
    values = {
      invoke_url = "https://test-api-id.execute-api.us-east-1.amazonaws.com/"
    }
  }
}

variables {
  lambda_zip_path = "./tests/placeholder.zip"
  domain_name     = "geo-mcp.responsive.city"
  hosted_zone_id  = "ZTESTZONE"
  environment_tag = "dev"
}

run "lambda_runtime_and_sizing" {
  command = plan

  assert {
    condition     = aws_lambda_function.geo.function_name == "rc-geo-mcp-dev"
    error_message = "function name must default to rc-geo-mcp-dev"
  }

  assert {
    condition     = aws_lambda_function.geo.runtime == "nodejs22.x"
    error_message = "runtime must be nodejs22.x"
  }

  assert {
    condition     = aws_lambda_function.geo.architectures[0] == "arm64"
    error_message = "architecture must be arm64"
  }

  assert {
    condition     = aws_lambda_function.geo.handler == "lambda.handler"
    error_message = "handler must be lambda.handler (the esbuild ESM bundle's export)"
  }

  assert {
    condition     = aws_lambda_function.geo.memory_size == 512
    error_message = "memory must default to 512"
  }

  assert {
    condition     = aws_lambda_function.geo.timeout == 29
    error_message = "timeout must default to 29"
  }
}

run "lambda_environment_carries_transport_and_catalog_path_not_a_key" {
  command = plan

  assert {
    condition     = aws_lambda_function.geo.environment[0].variables["MCP_TRANSPORT"] == "http"
    error_message = "MCP_TRANSPORT must be http"
  }

  # ADR-008 §7: the catalog is a file in the zip, addressed by GEO_CATALOG_PATH.
  assert {
    condition     = aws_lambda_function.geo.environment[0].variables["GEO_CATALOG_PATH"] == "/var/task/geo-catalog.sqlite"
    error_message = "GEO_CATALOG_PATH must point at the bundled catalog in the deployment package"
  }

  # This server carries no agency API key — the catalog is local data, not an upstream API.
  assert {
    condition     = !contains(keys(aws_lambda_function.geo.environment[0].variables), "BLS_API_KEY")
    error_message = "the geography server must not carry an agency API key"
  }
}

run "tracing_and_log_retention" {
  command = plan

  assert {
    condition     = aws_lambda_function.geo.tracing_config[0].mode == "Active"
    error_message = "X-Ray tracing must be Active"
  }

  assert {
    condition     = aws_cloudwatch_log_group.lambda.name == "/aws/lambda/rc-geo-mcp-dev"
    error_message = "lambda log group must be named after the function"
  }

  assert {
    condition     = aws_cloudwatch_log_group.lambda.retention_in_days == 30
    error_message = "log retention must default to 30 days"
  }
}

run "lambda_uses_the_admin_provisioned_execution_role" {
  command = plan

  # The execution role is provisioned by an administrator and read by data source
  # (ADR-007); the module attaches it to the Lambda by its <function_name>-role name.
  assert {
    condition     = data.aws_iam_role.exec.name == "rc-geo-mcp-dev-role"
    error_message = "the Lambda must reference the <function_name>-role execution role by name"
  }

  assert {
    condition     = aws_lambda_function.geo.role == data.aws_iam_role.exec.arn
    error_message = "the Lambda's role must be the admin-provisioned execution role's ARN"
  }
}

run "http_api_routes_post_and_get_mcp_to_the_lambda" {
  command = plan

  assert {
    condition     = aws_apigatewayv2_api.geo.protocol_type == "HTTP"
    error_message = "API must be an HTTP API"
  }

  assert {
    condition     = aws_apigatewayv2_integration.geo.integration_type == "AWS_PROXY"
    error_message = "integration must be AWS_PROXY"
  }

  assert {
    condition     = aws_apigatewayv2_integration.geo.payload_format_version == "2.0"
    error_message = "integration must use payload format 2.0"
  }

  assert {
    condition     = aws_apigatewayv2_route.post_mcp.route_key == "POST /mcp"
    error_message = "must route POST /mcp to the integration"
  }

  assert {
    condition     = aws_apigatewayv2_route.get_mcp.route_key == "GET /mcp"
    error_message = "must route GET /mcp to the integration (the handler answers 405)"
  }

  assert {
    condition     = aws_apigatewayv2_stage.default.name == "$default"
    error_message = "stage must be $default"
  }

  assert {
    condition     = aws_apigatewayv2_stage.default.auto_deploy == true
    error_message = "stage must auto-deploy"
  }
}

run "custom_domain_matches_the_instance_record" {
  command = plan

  assert {
    condition     = aws_acm_certificate.geo.domain_name == "geo-mcp.responsive.city"
    error_message = "certificate domain must equal var.domain_name"
  }

  assert {
    condition     = aws_acm_certificate.geo.validation_method == "DNS"
    error_message = "certificate must use DNS validation"
  }

  assert {
    condition     = aws_apigatewayv2_domain_name.geo.domain_name == "geo-mcp.responsive.city"
    error_message = "apigatewayv2 domain name must equal var.domain_name"
  }

  assert {
    condition     = aws_apigatewayv2_domain_name.geo.domain_name_configuration[0].endpoint_type == "REGIONAL"
    error_message = "domain endpoint must be REGIONAL"
  }

  assert {
    condition     = aws_apigatewayv2_domain_name.geo.domain_name_configuration[0].security_policy == "TLS_1_2"
    error_message = "domain must require TLS_1_2"
  }

  assert {
    condition     = aws_route53_record.alias_a.zone_id == "ZTESTZONE"
    error_message = "alias A record must be created in var.hosted_zone_id"
  }

  assert {
    condition     = aws_route53_record.alias_aaaa.zone_id == "ZTESTZONE"
    error_message = "alias AAAA record must be created in var.hosted_zone_id"
  }
}

run "outputs_expose_the_invoke_urls" {
  command = plan

  assert {
    condition     = output.custom_domain_url == "https://geo-mcp.responsive.city/mcp"
    error_message = "custom_domain_url must be https://<domain_name>/mcp"
  }

  assert {
    condition     = can(regex("/mcp$", output.invoke_url))
    error_message = "invoke_url must point at the /mcp route"
  }

  assert {
    condition     = output.function_name == "rc-geo-mcp-dev"
    error_message = "function_name output must equal the Lambda function name"
  }

  assert {
    condition     = output.lambda_role_arn == data.aws_iam_role.exec.arn
    error_message = "lambda_role_arn output must equal the execution role's ARN"
  }
}
