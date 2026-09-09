# terraform test — runs offline with a mocked aws provider (ADR-005 §2).
#
# `lambda_zip_path` points at the committed placeholder zip (tests/placeholder.zip)
# so `filebase64sha256` has a real file to hash without needing `npm run bundle`
# to have run first.

mock_provider "aws" {
  override_data {
    target = data.aws_secretsmanager_secret.bls
    values = {
      arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:federal-mcps/dev/bls-AbCdEf"
    }
  }

  # Everything below is `override_during = plan`, not the default (apply):
  # the mock provider's auto-generated values for Computed attributes are NOT
  # shaped like real ARNs, and several resources here feed one resource's
  # computed ARN into another resource's argument (role, certificate_arn,
  # destination_arn, ...), which the AWS provider validates client-side even
  # under mock_provider. Without these overrides, `command = plan` fails on
  # every run in this file — not just ones asserting the affected values.
  override_resource {
    target          = aws_iam_role.exec
    override_during = plan
    values = {
      arn = "arn:aws:iam::123456789012:role/federal-mcps-bls-exec"
    }
  }

  override_resource {
    target          = aws_cloudwatch_log_group.lambda
    override_during = plan
    values = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/federal-mcps-bls"
    }
  }

  override_resource {
    target          = aws_cloudwatch_log_group.api
    override_during = plan
    values = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/apigateway/federal-mcps-bls"
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
  secret_name     = "federal-mcps/dev/bls"
  environment_tag = "dev"
}

run "lambda_runtime_and_sizing" {
  command = plan

  assert {
    condition     = aws_lambda_function.bls.function_name == "federal-mcps-bls"
    error_message = "function name must default to federal-mcps-bls"
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

run "lambda_environment_carries_no_key_values" {
  command = plan

  assert {
    condition     = aws_lambda_function.bls.environment[0].variables["MCP_TRANSPORT"] == "http"
    error_message = "MCP_TRANSPORT must be http"
  }

  assert {
    condition     = aws_lambda_function.bls.environment[0].variables["BLS_SECRET_ARN"] == "arn:aws:secretsmanager:us-east-1:123456789012:secret:federal-mcps/dev/bls-AbCdEf"
    error_message = "BLS_SECRET_ARN must be the bls secret's ARN"
  }

  # No env var value may look like a raw key (a long unbroken alphanumeric run) —
  # only ARNs and fixed strings belong here, never a secret value.
  assert {
    condition = alltrue([
      for value in values(aws_lambda_function.bls.environment[0].variables) :
      !can(regex("^[A-Za-z0-9]{24,}$", value))
    ])
    error_message = "no Lambda environment value may look like a raw secret key"
  }
}

run "tracing_and_log_retention" {
  command = plan

  assert {
    condition     = aws_lambda_function.bls.tracing_config[0].mode == "Active"
    error_message = "X-Ray tracing must be Active"
  }

  assert {
    condition     = aws_cloudwatch_log_group.lambda.name == "/aws/lambda/federal-mcps-bls"
    error_message = "lambda log group must be named after the function"
  }

  assert {
    condition     = aws_cloudwatch_log_group.lambda.retention_in_days == 30
    error_message = "log retention must default to 30 days"
  }
}

run "execution_role_grants_exactly_the_documented_permissions" {
  command = plan

  assert {
    condition     = aws_iam_role.exec.name == "federal-mcps-bls-exec"
    error_message = "execution role must be named <function_name>-exec"
  }

  assert {
    condition = (
      jsondecode(aws_iam_role.exec.assume_role_policy).Statement[0].Principal.Service == "lambda.amazonaws.com"
    )
    error_message = "execution role must trust lambda.amazonaws.com"
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.exec.policy).Statement : alltrue([
        for action in statement.Action :
        contains([
          "logs:CreateLogStream", "logs:PutLogEvents", "logs:CreateLogGroup",
          "xray:PutTraceSegments", "xray:PutTelemetryRecords",
          "secretsmanager:GetSecretValue",
        ], action)
      ])
    ])
    error_message = "execution policy must contain no action outside the documented set"
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_role_policy.exec.policy).Statement :
      contains(statement.Action, "secretsmanager:GetSecretValue") &&
      statement.Resource == ["arn:aws:secretsmanager:us-east-1:123456789012:secret:federal-mcps/dev/bls-AbCdEf"]
    ])
    error_message = "secretsmanager:GetSecretValue must be scoped to exactly the bls secret's ARN"
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
    condition     = output.function_name == "federal-mcps-bls"
    error_message = "function_name output must equal the Lambda function name"
  }

  assert {
    condition     = output.lambda_role_arn == aws_iam_role.exec.arn
    error_message = "lambda_role_arn output must equal the execution role's ARN"
  }
}
