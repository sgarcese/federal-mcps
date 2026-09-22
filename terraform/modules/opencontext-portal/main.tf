# The OpenContext portal module (M10.3, ADR-016 §5): one OpenContext Lambda for a
# portal-hosted source that this family serves through a source guide (ADR-015) —
# CDC on data.cdc.gov first. Same shape as the agency modules (ADR-004 §5-6, ADR-005 §1):
# Lambda + HTTP API + custom domain (+ aliases), rc-<service>-<env> naming (ADR-006 §2),
# the execution role provisioned by an administrator and read here (ADR-007). What
# differs is the runtime: a Python Lambda built from a pinned OpenContext commit
# (opencontext.lock.json, scripts/bundle-opencontext.sh; ADR-016 §4), configured by a
# single OPENCONTEXT_CONFIG JSON environment variable rendered from this module's inputs.

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
  organization          = var.organization != "" ? var.organization : var.display_name

  # The OpenContext config (its config.yaml, as JSON). Plugin sections differ slightly by
  # type: arcgis takes portal_url only; the others also take base_url; a credential is
  # included only when one was given (the Socrata plugin treats absence as "no token").
  plugin_config = merge(
    {
      enabled    = true
      portal_url = var.portal_url
      city_name  = var.display_name
      timeout    = var.plugin_timeout
    },
    var.portal_type != "arcgis" ? { base_url = var.portal_url } : {},
    var.portal_type == "socrata" && var.app_token != "" ? { app_token = var.app_token } : {},
    var.portal_type == "ckan" && var.app_token != "" ? { api_key = var.app_token } : {},
  )

  config = {
    server_name  = "${var.display_name} Open Data MCP"
    description  = "Open data MCP for ${var.display_name}, served by federal-mcps${var.warning != "" ? " — WARNING: ${var.warning}" : ""}"
    organization = local.organization
    plugins      = { (var.portal_type) = local.plugin_config }
    aws = {
      lambda_name    = local.function_name
      lambda_memory  = var.memory_size
      lambda_timeout = var.timeout
    }
    logging = { level = "INFO", format = "json" }
  }
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

# Provisioned once by an administrator (scripts/admin-create-exec-role.sh <instance> <server>);
# the deploy identity cannot create IAM roles (ADR-007). Read and attached here only.
data "aws_iam_role" "exec" {
  name = "${local.function_name}-role"
}

resource "aws_lambda_function" "portal" {
  function_name = local.function_name
  role          = data.aws_iam_role.exec.arn

  # OpenContext is Python; the bundle installs wheels for x86_64-manylinux2014 / py3.11
  # (scripts/bundle-opencontext.sh), so the architecture must match.
  runtime       = "python3.11"
  architectures = ["x86_64"]
  handler       = "server.adapters.aws_lambda.lambda_handler"

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  memory_size = var.memory_size
  timeout     = var.timeout

  environment {
    variables = {
      OPENCONTEXT_CONFIG = jsonencode(local.config)
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

resource "aws_apigatewayv2_api" "portal" {
  name          = "${local.function_name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "portal" {
  api_id                 = aws_apigatewayv2_api.portal.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.portal.invoke_arn
  payload_format_version = "2.0"
}

# OpenContext answers POST /mcp (and 404s any other path itself); GET is routed so
# hosts probing the endpoint get the server's own answer rather than the gateway's.
resource "aws_apigatewayv2_route" "post_mcp" {
  api_id    = aws_apigatewayv2_api.portal.id
  route_key = "POST /mcp"
  target    = "integrations/${aws_apigatewayv2_integration.portal.id}"
}

resource "aws_apigatewayv2_route" "get_mcp" {
  api_id    = aws_apigatewayv2_api.portal.id
  route_key = "GET /mcp"
  target    = "integrations/${aws_apigatewayv2_integration.portal.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.portal.id
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
  function_name = aws_lambda_function.portal.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.portal.execution_arn}/*/*"
}

# --- Custom domain ---------------------------------------------------------

resource "aws_acm_certificate" "portal" {
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
    for dvo in aws_acm_certificate.portal.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "portal" {
  certificate_arn         = aws_acm_certificate.portal.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_apigatewayv2_domain_name" "portal" {
  domain_name = var.domain_name

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.portal.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "portal" {
  api_id      = aws_apigatewayv2_api.portal.id
  domain_name = aws_apigatewayv2_domain_name.portal.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "alias_a" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.portal.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.portal.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_aaaa" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_apigatewayv2_domain_name.portal.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.portal.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
