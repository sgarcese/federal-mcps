output "deploy_role_arn" {
  description = "Must equal instances.json → dev → deployRoleArn."
  value       = module.github_oidc_deploy_role.role_arn
}

output "state_bucket" {
  value = local.state_bucket
}

output "bls_invoke_url" {
  value = module.bls_server.invoke_url
}

output "bls_custom_domain_url" {
  description = "Must equal https://<instances.json → dev → domain.blsDomainName>/mcp."
  value       = module.bls_server.custom_domain_url
}
