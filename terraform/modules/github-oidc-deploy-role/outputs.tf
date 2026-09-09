output "role_arn" {
  description = "ARN of the deploy role. Must equal the instance record's deployRoleArn."
  value       = aws_iam_role.deploy.arn
}

output "role_name" {
  value = aws_iam_role.deploy.name
}

output "github_subject" {
  description = "The OIDC subject the trust policy accepts."
  value       = local.github_subject
}
