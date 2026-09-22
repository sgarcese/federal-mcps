output "invoke_url" {
  description = "The default stage's own invoke URL, at /mcp (works before DNS/ACM validation propagates)."
  value       = "${aws_apigatewayv2_stage.default.invoke_url}mcp"
}

output "custom_domain_url" {
  description = "The stable, per-server hostname (ADR-004 §5), at /mcp."
  value       = "https://${var.domain_name}/mcp"
}

output "function_name" {
  value = aws_lambda_function.geo.function_name
}

output "lambda_role_arn" {
  value = data.aws_iam_role.exec.arn
}

output "alias_urls" {
  description = "Every alias hostname (ADR-016 §2), at /mcp; empty when no aliases are configured."
  value       = [for a in var.alias_domain_names : "https://${a}/mcp"]
}
