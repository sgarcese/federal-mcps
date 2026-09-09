# The BLS server module (#9, ADR-004 §5-6, ADR-005 §1): Lambda + HTTP API +
# custom domain for one agency server, configured through environment variables (ADR-006). Follows the style of
# jsonencode locals for IAM policies so
# `terraform test` can assert on them under a mocked provider, and the
# account's rc-<service>-<env> naming the deploy role's permissions are scoped to.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0"
    }
  }
}

locals {
  function_name         = "${var.service_name}-${var.environment_tag}"
  lambda_log_group_name = "/aws/lambda/${local.function_name}"
  api_log_group_name    = "/aws/apigateway/${local.function_name}"
}

# --- Lambda ------------------------------------------------------------

resource "aws_cloudwatch_log_group" "lambda" {
  name              = local.lambda_log_group_name
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "api" {
  name              = local.api_log_group_name
  retention_in_days = var.log_retention_days
}

locals {
  exec_trust_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "LambdaAssume"
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  # Exactly logs on its own log group and X-Ray — nothing else.
  exec_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WriteOwnLogGroup"
        Effect = "Allow"
        Action = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:CreateLogGroup"]
        Resource = [
          aws_cloudwatch_log_group.lambda.arn,
          "${aws_cloudwatch_log_group.lambda.arn}:*",
        ]
      },
      {
        Sid      = "XRayTracing"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = ["*"]
      },
    ]
  })
}

resource "aws_iam_role" "exec" {
  name               = "${local.function_name}-role"
  description        = "Execution role for the ${local.function_name} Lambda"
  assume_role_policy = local.exec_trust_policy
}

resource "aws_iam_role_policy" "exec" {
  name   = "${local.function_name}-role"
  role   = aws_iam_role.exec.id
  policy = local.exec_policy
}

resource "aws_lambda_function" "bls" {
  function_name = local.function_name
  role          = aws_iam_role.exec.arn

  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "lambda.handler"

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  memory_size = var.memory_size
  timeout     = var.timeout

  environment {
    variables = {
      MCP_TRANSPORT = "http"
      BLS_API_KEY   = var.bls_api_key
    }
  }

  tracing_config {
    mode = "Active"
  }

  tags = {
    project     = "federal-mcps"
    environment = var.environment_tag
  }

  depends_on = [aws_cloudwatch_log_group.lambda, aws_iam_role_policy.exec]
}

# --- HTTP API ------------------------------------------------------------

resource "aws_apigatewayv2_api" "bls" {
  name          = "${local.function_name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "bls" {
  api_id                 = aws_apigatewayv2_api.bls.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.bls.invoke_arn
  payload_format_version = "2.0"
}

# GET /mcp also routes to the Lambda; the handler itself answers 405 (core's
# createHttpHandler refuses non-POST) — the route exists so API Gateway
# forwards the request instead of 404ing it.
resource "aws_apigatewayv2_route" "post_mcp" {
  api_id    = aws_apigatewayv2_api.bls.id
  route_key = "POST /mcp"
  target    = "integrations/${aws_apigatewayv2_integration.bls.id}"
}

resource "aws_apigatewayv2_route" "get_mcp" {
  api_id    = aws_apigatewayv2_api.bls.id
  route_key = "GET /mcp"
  target    = "integrations/${aws_apigatewayv2_integration.bls.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.bls.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format = jsonencode({
      requestId = "$context.requestId"
      status    = "$context.status"
      ip        = "$context.identity.sourceIp"
      routeKey  = "$context.routeKey"
      error     = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.bls.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.bls.execution_arn}/*/*"
}

# --- Custom domain ---------------------------------------------------------

resource "aws_acm_certificate" "bls" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  tags = {
    project     = "federal-mcps"
    environment = var.environment_tag
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.bls.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "bls" {
  certificate_arn         = aws_acm_certificate.bls.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_apigatewayv2_domain_name" "bls" {
  domain_name = var.domain_name

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.bls.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "bls" {
  api_id      = aws_apigatewayv2_api.bls.id
  domain_name = aws_apigatewayv2_domain_name.bls.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "alias_a" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.bls.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.bls.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_aaaa" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_apigatewayv2_domain_name.bls.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.bls.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
