output "deploy_role_arn" {
  description = "Must equal instances.json → dev → deployRoleArn."
  value       = module.github_oidc_deploy_role.role_arn
}

output "state_bucket" {
  value = local.state_bucket
}
