output "invoke_url" {
  description = "The default stage's own invoke URL, at /mcp (works before DNS/ACM validation propagates)."
  value       = "${aws_apigatewayv2_stage.default.invoke_url}mcp"
}

output "custom_domain_url" {
  description = "The stable, per-server hostname (ADR-004 §5), at /mcp."
  value       = "https://${var.domain_name}/mcp"
}

output "function_name" {
  value = aws_lambda_function.census.function_name
}

output "lambda_role_arn" {
  value = data.aws_iam_role.exec.arn
}

output "alias_urls" {
  description = "Every alias hostname (ADR-016 §2), at /mcp; empty when no aliases are configured."
  value       = [for a in var.alias_domain_names : "https://${a}/mcp"]
}

output "lambda_limits_json" {
  description = "The rendered FEDERAL_MCPS_LIMITS (#319, ADR-020; for tests)."
  value       = local.limits_json
}

output "limits_table_name" {
  description = "The DynamoDB table set as FEDERAL_MCPS_LIMITS_TABLE (#322, ADR-020 §2)."
  value       = local.limits_table_name
}
