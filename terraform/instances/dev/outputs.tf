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

output "census_invoke_url" {
  value = module.census_server.invoke_url
}

output "census_custom_domain_url" {
  description = "Must equal https://<instances.json → dev → domain.censusDomainName>/mcp."
  value       = module.census_server.custom_domain_url
}

output "bls_alias_urls" {
  description = "Alias hostnames for the bls server at /mcp (instances.json → domain.aliases.bls; ADR-016 §2)."
  value       = module.bls_server.alias_urls
}

output "geo_alias_urls" {
  description = "Alias hostnames for the geo server at /mcp (instances.json → domain.aliases.geo; ADR-016 §2)."
  value       = module.geo_server.alias_urls
}

output "census_alias_urls" {
  description = "Alias hostnames for the census server at /mcp (instances.json → domain.aliases.census; ADR-016 §2)."
  value       = module.census_server.alias_urls
}
