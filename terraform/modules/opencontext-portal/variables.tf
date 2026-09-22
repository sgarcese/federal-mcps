variable "service_name" {
  description = "Service name in the account's rc-<service> pattern (ADR-006 §2), e.g. rc-cdc-mcp; the function is <service_name>-<environment_tag>."
  type        = string
}

variable "display_name" {
  description = "Human name of the source, shown in the MCP server name and tool descriptions (OpenContext city_name), e.g. \"CDC\"."
  type        = string
}

variable "organization" {
  description = "Organization named in the OpenContext config; defaults to display_name."
  type        = string
  default     = ""
}

variable "portal_type" {
  description = "OpenContext plugin for the portal: socrata, arcgis, ckan or opendatasoft."
  type        = string

  validation {
    condition     = contains(["socrata", "arcgis", "ckan", "opendatasoft"], var.portal_type)
    error_message = "portal_type must be one of socrata, arcgis, ckan, opendatasoft."
  }
}

variable "portal_url" {
  description = "The portal's public URL, e.g. https://data.cdc.gov."
  type        = string
}

variable "app_token" {
  description = "Optional portal credential (a Socrata App Token, or a CKAN api_key); sent to the Lambda inside OPENCONTEXT_CONFIG. Empty means none (ADR-006 §3 pattern; supplied as TF_VAR_socrata_app_token from .env)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "warning" {
  description = "Optional caveat appended to the server description shown to hosts (e.g. partial coverage)."
  type        = string
  default     = ""
}

variable "plugin_timeout" {
  description = "HTTP timeout (seconds) for the OpenContext plugin's upstream calls; must stay under the Lambda timeout."
  type        = number
  default     = 25
}

variable "lambda_zip_path" {
  description = "Path to the OpenContext deployment zip built by scripts/bundle-opencontext.sh (build/opencontext-lambda.zip in the instance root; a committed placeholder in this module's own tests)."
  type        = string
}

variable "domain_name" {
  description = "Custom hostname for this portal (instances.json → domain.<service>DomainName)."
  type        = string
}

variable "alias_domain_names" {
  description = "Additional hostnames served by the same API (ADR-016 §2)."
  type        = list(string)
  default     = []
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone to create validation and alias records in (instances.json → domain.hostedZoneId)."
  type        = string
}

variable "environment_tag" {
  description = "Environment tag (dev, prod, ...) from the instance record."
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
