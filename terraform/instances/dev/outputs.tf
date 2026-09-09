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

output "geo_invoke_url" {
  value = module.geo_server.invoke_url
}

output "geo_custom_domain_url" {
  description = "Must equal https://<instances.json → dev → domain.geoDomainName>/mcp."
  value       = module.geo_server.custom_domain_url
}
