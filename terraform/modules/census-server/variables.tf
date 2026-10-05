variable "service_name" {
  description = "Service name in the account's rc-<service> pattern (ADR-006 §2); the function is <service_name>-<environment_tag>."
  type        = string
  default     = "rc-census-mcp"
}

variable "census_api_key" {
  description = "Census Data API key (required for every data query), set on the Lambda as CENSUS_API_KEY (ADR-006 §3)."
  type        = string
  sensitive   = true
}

variable "lambda_zip_path" {
  description = "Path to the esbuild bundle zip, catalog baked in (packages/server-census/dist/lambda.zip in the instance root; a committed placeholder in this module's own tests)."
  type        = string
}

variable "catalog_path" {
  description = "Where the bundled geography catalog lands inside the deployment package; set on the Lambda as GEO_CATALOG_PATH (#59, ADR-008 §7). Not a secret."
  type        = string
  default     = "/var/task/geo-catalog.sqlite"
}

variable "domain_name" {
  description = "Custom hostname for this server (instances.json → domain.censusDomainName)."
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

variable "alias_domain_names" {
  description = "Additional hostnames served by the same API (ADR-016 §2), e.g. the short `<service>.responsive.city` name next to the original `*-mcp` name in domain_name; each gets its own certificate, domain name, mapping and records. From instances.json → domain.aliases.<service>."
  type        = list(string)
  default     = []
}

# --- Public-use protection (#319, ADR-020 §2, §6, §7) -----------------------

variable "throttling_rate_limit" {
  description = "API Gateway $default stage steady-state requests/second (ADR-020 §6); from instances.json → limits.census.stageRateLimit."
  type        = number
  default     = 10
  nullable    = false
}

variable "throttling_burst_limit" {
  description = "API Gateway $default stage burst capacity (ADR-020 §6); from instances.json → limits.census.stageBurstLimit."
  type        = number
  default     = 20
  nullable    = false
}

variable "reserved_concurrency" {
  description = "Lambda reserved concurrency, a cost/noisy-neighbour ceiling (ADR-020 §6); from instances.json → limits.census.reservedConcurrency."
  type        = number
  default     = 5
  nullable    = false
}

variable "service_daily_limit" {
  description = "Family-wide daily Census API query budget (ADR-020 §6), keyed into FEDERAL_MCPS_LIMITS.serviceDaily.census; from instances.json → limits.census.serviceDaily."
  type        = number
  default     = 5000
  nullable    = false
}

variable "network_upstream_daily" {
  description = "Per-network daily Census upstream query share (ADR-020 §6, question 5); from instances.json → limits.census.network.upstreamDaily."
  type        = number
  default     = 1000
  nullable    = false
}

variable "network_tool_calls_daily" {
  description = "Per-network daily tool-call ceiling (ADR-020 §6); from instances.json → limits.census.network.toolCallsDaily."
  type        = number
  default     = 500
  nullable    = false
}

variable "pool_upstream_daily" {
  description = "The claude.ai pool's daily Census upstream query share (ADR-020 §6); from instances.json → limits.census.pool.upstreamDaily."
  type        = number
  default     = 3000
  nullable    = false
}

variable "pool_tool_calls_daily" {
  description = "The claude.ai pool's daily tool-call ceiling (ADR-020 §6); from instances.json → limits.census.pool.toolCallsDaily."
  type        = number
  default     = 5000
  nullable    = false
}

variable "upstream_per_minute" {
  description = "Agency per-minute upstream quota, before the reserved-concurrency split (ADR-020 §2); Census has none, so this stays null unless the fleet record sets it."
  type        = number
  default     = null
}

variable "upstream_errors_per_minute" {
  description = "Agency per-minute upstream error quota (ADR-020 §2); Census has none, so this stays null unless the fleet record sets it."
  type        = number
  default     = null
}

variable "caller_hmac_secret" {
  description = "HMAC secret for daily-rotating caller keys (ADR-020 §1), set on the Lambda as FEDERAL_MCPS_CALLER_SECRET. Optional: empty runs without per-identity limits (ADR-006 §3 pattern; supplied as TF_VAR_caller_hmac_secret from .env)."
  type        = string
  default     = ""
  sensitive   = true
  nullable    = false
}

variable "operator_bypass_token" {
  description = "Expected value of the operator-bypass header (ADR-020 §9), set on the Lambda as FEDERAL_MCPS_OPERATOR_TOKEN. Never documented publicly; optional (supplied as TF_VAR_operator_bypass_token from .env)."
  type        = string
  default     = ""
  sensitive   = true
  nullable    = false
}
