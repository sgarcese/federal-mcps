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

output "hud_invoke_url" {
  value = module.hud_server.invoke_url
}

output "hud_custom_domain_url" {
  description = "Must equal https://<instances.json → dev → domain.hudDomainName>/mcp."
  value       = module.hud_server.custom_domain_url
}

output "hud_alias_urls" {
  description = "Alias hostnames for the hud server at /mcp (instances.json → domain.aliases.hud; ADR-016 §2)."
  value       = module.hud_server.alias_urls
}

output "bea_invoke_url" {
  value = module.bea_server.invoke_url
}

output "bea_custom_domain_url" {
  description = "Must equal https://<instances.json → dev → domain.beaDomainName>/mcp."
  value       = module.bea_server.custom_domain_url
}

output "bea_alias_urls" {
  description = "Alias hostnames for the bea server at /mcp (instances.json → domain.aliases.bea; ADR-016 §2)."
  value       = module.bea_server.alias_urls
}

output "cdc_invoke_url" {
  value = module.cdc_portal.invoke_url
}

output "cdc_custom_domain_url" {
  description = "Must equal https://<instances.json → dev → domain.cdcDomainName>/mcp."
  value       = module.cdc_portal.custom_domain_url
}

output "cdc_alias_urls" {
  value = module.cdc_portal.alias_urls
}

output "monitoring_dashboard_name" {
  description = "Must equal rc-federal-mcps-<env> (#326, ADR-020 §5)."
  value       = module.monitoring.dashboard_name
}

output "monitoring_alerts_topic_arn" {
  value = module.monitoring.alerts_topic_arn
}

output "monitoring_has_email_subscription" {
  description = "True only when instances.json carries alerts.email (scripts/instance.mjs)."
  value       = module.monitoring.has_email_subscription
}
