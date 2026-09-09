# terraform test — runs offline with a mocked aws provider (ADR-005 §2).
#
# `lambda_zip_path` points at the committed placeholder zip (tests/placeholder.zip)
# so `filebase64sha256` has a real file to hash without needing `npm run bundle`
# to have run first.

mock_provider "aws" {
  # Everything below is `override_during = plan`, not the default (apply):
  # the mock provider's auto-generated values for Computed attributes are NOT
  # shaped like real ARNs, and several resources here feed one resource's
  # computed ARN into another resource's argument (role, certificate_arn,
  # destination_arn, ...), which the AWS provider validates client-side even
  # under mock_provider. Without these overrides, `command = plan` fails on
  # every run in this file — not just ones asserting the affected values.
  override_data {
    target = data.aws_iam_role.exec
    values = {
      arn = "arn:aws:iam::123456789012:role/rc-bls-mcp-dev-role"
    }
  }

  override_resource {
    target          = aws_cloudwatch_log_group.lambda
    override_during = plan
    values = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/rc-bls-mcp-dev"
    }
  }

  override_resource {
    target          = aws_cloudwatch_log_group.api
    override_during = plan
    values = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/apigateway/rc-bls-mcp-dev"
    }
  }

  override_resource {
    target          = aws_apigatewayv2_api.bls
    override_during = plan
    values = {
      execution_arn = "arn:aws:execute-api:us-east-1:123456789012:test-api-id"
    }
  }

  override_resource {
    target          = aws_acm_certificate.bls
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
    target          = aws_apigatewayv2_stage.default
    override_during = plan
    values = {
      invoke_url = "https://test-api-id.execute-api.us-east-1.amazonaws.com/"
    }
  }
}

variables {
  lambda_zip_path = "./tests/placeholder.zip"
  domain_name     = "bls-mcp.responsive.city"
  hosted_zone_id  = "ZTESTZONE"
  bls_api_key     = "test-key-value"
  environment_tag = "dev"
}

run "lambda_runtime_and_sizing" {
  command = plan

  assert {
    condition     = aws_lambda_function.bls.function_name == "rc-bls-mcp-dev"
    error_message = "function name must default to rc-bls-mcp-dev"
  }

  assert {
    condition     = aws_lambda_function.bls.runtime == "nodejs22.x"
    error_message = "runtime must be nodejs22.x"
  }

  assert {
    condition     = aws_lambda_function.bls.architectures[0] == "arm64"
    error_message = "architecture must be arm64"
  }

  assert {
    condition     = aws_lambda_function.bls.handler == "lambda.handler"
    error_message = "handler must be lambda.handler (the esbuild ESM bundle's export)"
  }

  assert {
    condition     = aws_lambda_function.bls.memory_size == 512
    error_message = "memory must default to 512"
  }

  assert {
    condition     = aws_lambda_function.bls.timeout == 29
    error_message = "timeout must default to 29"
  }
}

run "lambda_environment_carries_transport_and_key" {
  command = plan

  assert {
    condition     = aws_lambda_function.bls.environment[0].variables["MCP_TRANSPORT"] == "http"
    error_message = "MCP_TRANSPORT must be http"
  }

  # ADR-006 §3: the key rides as an environment variable from a sensitive variable.
  assert {
    condition     = aws_lambda_function.bls.environment[0].variables["BLS_API_KEY"] == "test-key-value"
    error_message = "BLS_API_KEY must be set from var.bls_api_key"
  }

  assert {
    condition     = !contains(keys(aws_lambda_function.bls.environment[0].variables), "BLS_SECRET_ARN")
    error_message = "no Secrets Manager indirection remains"
  }
}

run "tracing_and_log_retention" {
  command = plan

  assert {
    condition     = aws_lambda_function.bls.tracing_config[0].mode == "Active"
    error_message = "X-Ray tracing must be Active"
  }

  assert {
    condition     = aws_cloudwatch_log_group.lambda.name == "/aws/lambda/rc-bls-mcp-dev"
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
    condition     = data.aws_iam_role.exec.name == "rc-bls-mcp-dev-role"
    error_message = "the Lambda must reference the <function_name>-role execution role by name"
  }

  assert {
    condition     = aws_lambda_function.bls.role == data.aws_iam_role.exec.arn
    error_message = "the Lambda's role must be the admin-provisioned execution role's ARN"
  }
}

run "http_api_routes_post_and_get_mcp_to_the_lambda" {
  command = plan

  assert {
    condition     = aws_apigatewayv2_api.bls.protocol_type == "HTTP"
    error_message = "API must be an HTTP API"
  }

  assert {
    condition     = aws_apigatewayv2_integration.bls.integration_type == "AWS_PROXY"
    error_message = "integration must be AWS_PROXY"
  }

  assert {
    condition     = aws_apigatewayv2_integration.bls.payload_format_version == "2.0"
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
    condition     = aws_acm_certificate.bls.domain_name == "bls-mcp.responsive.city"
    error_message = "certificate domain must equal var.domain_name"
  }

  assert {
    condition     = aws_acm_certificate.bls.validation_method == "DNS"
    error_message = "certificate must use DNS validation"
  }

  assert {
    condition     = aws_apigatewayv2_domain_name.bls.domain_name == "bls-mcp.responsive.city"
    error_message = "apigatewayv2 domain name must equal var.domain_name"
  }

  assert {
    condition     = aws_apigatewayv2_domain_name.bls.domain_name_configuration[0].endpoint_type == "REGIONAL"
    error_message = "domain endpoint must be REGIONAL"
  }

  assert {
    condition     = aws_apigatewayv2_domain_name.bls.domain_name_configuration[0].security_policy == "TLS_1_2"
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
    condition     = output.custom_domain_url == "https://bls-mcp.responsive.city/mcp"
    error_message = "custom_domain_url must be https://<domain_name>/mcp"
  }

  assert {
    condition     = can(regex("/mcp$", output.invoke_url))
    error_message = "invoke_url must point at the /mcp route"
  }

  assert {
    condition     = output.function_name == "rc-bls-mcp-dev"
    error_message = "function_name output must equal the Lambda function name"
  }

  assert {
    condition     = output.lambda_role_arn == data.aws_iam_role.exec.arn
    error_message = "lambda_role_arn output must equal the execution role's ARN"
  }
}
