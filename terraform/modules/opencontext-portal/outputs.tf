output "invoke_url" {
  description = "The default stage's own invoke URL, at /mcp (works before DNS/ACM validation propagates)."
  value       = "${aws_apigatewayv2_stage.default.invoke_url}mcp"
}

output "custom_domain_url" {
  description = "The stable hostname (ADR-016 §2), at /mcp."
  value       = "https://${var.domain_name}/mcp"
}

output "alias_urls" {
  description = "Every alias hostname at /mcp; empty when none are configured."
  value       = [for a in var.alias_domain_names : "https://${a}/mcp"]
}

output "function_name" {
  value = aws_lambda_function.portal.function_name
}

output "lambda_role_arn" {
  value = data.aws_iam_role.exec.arn
}

output "lambda_config_json" {
  description = "The rendered OPENCONTEXT_CONFIG (for tests); sensitive because it may carry a token."
  value       = jsonencode(local.config)
  sensitive   = true
}
