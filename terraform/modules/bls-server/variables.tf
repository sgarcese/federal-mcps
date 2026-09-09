variable "name_prefix" {
  description = "Prefix every federal-mcps-managed resource name carries (matches the deploy role's scoping, ADR-005)."
  type        = string
  default     = "federal-mcps-"
}

variable "function_name" {
  description = "Lambda function name; also names the execution role (<function_name>-exec) and log groups."
  type        = string
  default     = "federal-mcps-bls"
}

variable "lambda_zip_path" {
  description = "Path to the esbuild bundle zip (packages/server-bls/dist/lambda.zip in the instance root; a committed placeholder in this module's own tests)."
  type        = string
}

variable "domain_name" {
  description = "Custom hostname for this server (instances.json → domain.blsDomainName)."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone to create validation and alias records in (instances.json → domain.hostedZoneId)."
  type        = string
}

variable "secret_name" {
  description = "Name of the pre-existing Secrets Manager secret the Lambda may read (instances.json → secrets.bls)."
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
