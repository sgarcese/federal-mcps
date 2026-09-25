# The HUD User server module (M11 shell, ADR-018; ADR-004 §5-6, ADR-005 §1): Lambda + HTTP
# API + custom domain for one agency server, configured through environment variables
# (ADR-006). The execution role is provisioned by an administrator and read here
# (ADR-007), because the deploy identity cannot create IAM roles. Resources are
# named rc-<service>-<env> (ADR-006 §2).

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

# The execution role is provisioned once by an administrator, not by this module:
# the deploy identity (rc-deploy) cannot create IAM roles in this account (ADR-007).
# `scripts/admin-create-exec-role.sh` creates `<function_name>-role` with the trust
# and inline policy (logs on this Lambda's log group + X-Ray) and grants rc-deploy
# iam:PassRole on it. Terraform only reads and attaches it.
data "aws_iam_role" "exec" {
  name = "${local.function_name}-role"
}

resource "aws_lambda_function" "hud" {
  function_name = local.function_name
  role          = data.aws_iam_role.exec.arn

  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "lambda.handler"

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  memory_size = var.memory_size
  timeout     = var.timeout

  environment {
    variables = {
      MCP_TRANSPORT  = "http"
      HUD_USER_TOKEN = var.hud_user_token
      # The HUD server resolves places off the bundled geography catalog (ADR-008 §7),
      # baked into this Lambda's zip like server-census's. Not a secret.
      GEO_CATALOG_PATH = var.catalog_path
    }
  }

  tracing_config {
    mode = "Active"
  }

  tags = {
    project     = "federal-mcps"
    environment = var.environment_tag
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# --- HTTP API ------------------------------------------------------------

resource "aws_apigatewayv2_api" "hud" {
  name          = "${local.function_name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "hud" {
  api_id                 = aws_apigatewayv2_api.hud.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.hud.invoke_arn
  payload_format_version = "2.0"
}

# GET /mcp also routes to the Lambda; the handler itself answers 405 (core's
# createHttpHandler refuses non-POST) — the route exists so API Gateway
# forwards the request instead of 404ing it.
resource "aws_apigatewayv2_route" "post_mcp" {
  api_id    = aws_apigatewayv2_api.hud.id
  route_key = "POST /mcp"
  target    = "integrations/${aws_apigatewayv2_integration.hud.id}"
}

resource "aws_apigatewayv2_route" "get_mcp" {
  api_id    = aws_apigatewayv2_api.hud.id
  route_key = "GET /mcp"
  target    = "integrations/${aws_apigatewayv2_integration.hud.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.hud.id
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
  function_name = aws_lambda_function.hud.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.hud.execution_arn}/*/*"
}

# --- Custom domain ---------------------------------------------------------

resource "aws_acm_certificate" "hud" {
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
    for dvo in aws_acm_certificate.hud.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "hud" {
  certificate_arn         = aws_acm_certificate.hud.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_apigatewayv2_domain_name" "hud" {
  domain_name = var.domain_name

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.hud.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "hud" {
  api_id      = aws_apigatewayv2_api.hud.id
  domain_name = aws_apigatewayv2_domain_name.hud.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "alias_a" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.hud.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.hud.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_aaaa" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_apigatewayv2_domain_name.hud.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.hud.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
