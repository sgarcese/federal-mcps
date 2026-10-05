# #326, ADR-020 §5: the monitoring module's inputs. Every resource this module creates is
# named rc-* (admin-grant-protection.sh grants rc-deploy CloudWatch/SNS/Budgets rights scoped
# to rc-* names only — see that script's step 3), and no email means no SNS subscription and
# no Budgets notification (the fleet record's optional `alerts.email`, scripts/instance.mjs).

variable "environment_tag" {
  description = "Environment suffix (e.g. \"dev\"), used in every rc-federal-mcps-<env>-* name."
  type        = string
}

variable "alert_email" {
  description = <<-EOT
    Where the rc-federal-mcps-<env>-alerts SNS topic and the AWS Budgets alert notify
    (instances.json's optional alerts.email, ADR-020 §5). Null (the default) creates the SNS
    topic and every alarm, but no email subscription and no Budgets notification — the
    address is per-deployer and never committed.
  EOT
  type        = string
  default     = null
  nullable    = true
}

variable "budget_amount_usd" {
  description = "Monthly AWS Budgets cost alert threshold in USD, on the project=federal-mcps cost-allocation tag. Default $50 (ADR-020 §5's monitoring cost estimate is far below this; it is a backstop, not a tight ceiling)."
  type        = number
  default     = 50
}

variable "services" {
  description = "Agency codes that emit the FederalMCPs EMF metrics (server/metrics.ts): one Errors alarm per service, and the dashboard's per-server widgets. Excludes the CDC OpenContext portal, which core's in-app metrics layer does not reach (ADR-020 §2)."
  type        = list(string)
  default     = ["bls", "census", "hud", "bea", "geo"]
}

variable "lambda_function_names" {
  description = "Every family Lambda's function name (including the CDC portal), for the AWS/Lambda Throttles and Errors alarms, which core's EMF line does not cover."
  type        = list(string)
  default     = []
}

variable "bls_budget_warning_pct" {
  description = "ServiceBudgetUsedPct (source=bls) threshold for the warning alarm (ADR-020 §5: \"BLS budget ≥ 80%\")."
  type        = number
  default     = 80
}

variable "bls_budget_critical_pct" {
  description = "ServiceBudgetUsedPct (source=bls) threshold for the critical alarm."
  type        = number
  default     = 100
}

variable "refusal_spike_threshold" {
  description = "Refusals summed across every server and scope, in one hour, past which the spike alarm fires (the spike's question-4 suggestion: \"over 50 in an hour\")."
  type        = number
  default     = 50
}

variable "error_rate_threshold" {
  description = "Errors for one server, in a 15-minute window, past which that server's error alarm fires."
  type        = number
  default     = 10
}
