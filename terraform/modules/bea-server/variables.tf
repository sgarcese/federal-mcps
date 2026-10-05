variable "service_name" {
  description = "Service name in the account's rc-<service> pattern (ADR-006 §2); the function is <service_name>-<environment_tag>."
  type        = string
  default     = "rc-bea-mcp"
}

variable "bea_api_key" {
  description = "BEA Data API key (required for every data query, ADR-019 §3), set on the Lambda as BEA_API_KEY (ADR-006 §3)."
  type        = string
  sensitive   = true
}

variable "lambda_zip_path" {
  description = "Path to the esbuild bundle zip, catalog baked in (packages/server-bea/dist/lambda.zip in the instance root; a committed placeholder in this module's own tests)."
  type        = string
}

variable "catalog_path" {
  description = "Where the bundled geography catalog lands inside the deployment package; set on the Lambda as GEO_CATALOG_PATH (ADR-008 §7). Not a secret."
  type        = string
  default     = "/var/task/geo-catalog.sqlite"
}

variable "domain_name" {
  description = "Custom hostname for this server (instances.json → domain.beaDomainName)."
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
  description = "Additional hostnames served by the same API (ADR-016 §2), each getting its own certificate, domain name, mapping and records. From instances.json → domain.aliases.<service>."
  type        = list(string)
  default     = []
}

# --- Public-use protection (#319, ADR-020 §2, §6, §7) -----------------------

variable "throttling_rate_limit" {
  description = "API Gateway $default stage steady-state requests/second (ADR-020 §6); from instances.json → limits.bea.stageRateLimit."
  type        = number
  default     = 10
  nullable    = false
}

variable "throttling_burst_limit" {
  description = "API Gateway $default stage burst capacity (ADR-020 §6); from instances.json → limits.bea.stageBurstLimit."
  type        = number
  default     = 20
  nullable    = false
}

variable "reserved_concurrency" {
  description = "Lambda reserved concurrency, a cost/noisy-neighbour ceiling (ADR-020 §6); from instances.json → limits.bea.reservedConcurrency."
  type        = number
  default     = 2
  nullable    = false
}

variable "service_daily_limit" {
  description = "Family-wide daily BEA API query budget (ADR-020 §6); BEA publishes no daily cap (only per-minute quotas), so this stays null unless the fleet record sets it."
  type        = number
  default     = null
}

variable "network_upstream_daily" {
  description = "Per-network daily BEA upstream query share (ADR-020 §6, question 5); from instances.json → limits.bea.network.upstreamDaily."
  type        = number
  default     = 1000
  nullable    = false
}

variable "network_tool_calls_daily" {
  description = "Per-network daily tool-call ceiling (ADR-020 §6); from instances.json → limits.bea.network.toolCallsDaily."
  type        = number
  default     = 500
  nullable    = false
}

variable "pool_upstream_daily" {
  description = "The claude.ai pool's daily BEA upstream query share (ADR-020 §6); from instances.json → limits.bea.pool.upstreamDaily."
  type        = number
  default     = 3000
  nullable    = false
}

variable "pool_tool_calls_daily" {
  description = "The claude.ai pool's daily tool-call ceiling (ADR-020 §6); from instances.json → limits.bea.pool.toolCallsDaily."
  type        = number
  default     = 5000
  nullable    = false
}

variable "upstream_per_minute" {
  description = "BEA Data API's per-minute request quota (BEA_PER_MINUTE = 90, see packages/server-bea/src/bea-api.ts), before the reserved-concurrency split core performs; from instances.json → limits.bea.upstreamPerMinute."
  type        = number
  default     = 90
  nullable    = false
}

variable "upstream_errors_per_minute" {
  description = "BEA Data API's per-minute error quota (30 errors/minute); from instances.json → limits.bea.upstreamErrorsPerMinute."
  type        = number
  default     = 30
  nullable    = false
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
