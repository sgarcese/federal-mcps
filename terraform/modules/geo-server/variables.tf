variable "service_name" {
  description = "Service name in the account's rc-<service> pattern (ADR-006 §2); the function is <service_name>-<environment_tag>."
  type        = string
  default     = "rc-geo-mcp"
}

variable "lambda_zip_path" {
  description = "Path to the esbuild bundle zip, catalog baked in (packages/server-geo/dist/lambda.zip in the instance root; a committed placeholder in this module's own tests)."
  type        = string
}

variable "catalog_path" {
  description = "Where the bundled geography catalog lands inside the deployment package; set on the Lambda as GEO_CATALOG_PATH (ADR-008 §7). Not a secret."
  type        = string
  default     = "/var/task/geo-catalog.sqlite"
}

variable "domain_name" {
  description = "Custom hostname for this server (instances.json → domain.geoDomainName)."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone to create validation and alias records in (instances.json → domain.hostedZoneId)."
  type        = string
}

variable "environment_tag" {
  description = "Environment tag (dev, prod, ...) from the instance record; carried on resources that don't inherit provider default_tags."
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the Lambda and API access logs."
  type        = number
  default     = 30
}

variable "memory_size" {
  description = "Lambda memory (MB)."
  type        = number
  default     = 512
}

variable "timeout" {
  description = "Lambda timeout (seconds); kept under the HTTP API's 30s integration timeout."
  type        = number
  default     = 29
}
