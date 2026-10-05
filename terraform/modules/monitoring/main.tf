# The monitoring module (#326, ADR-020 §5): one dashboard, about ten alarms, an SNS topic
# and an optional email subscription, and an optional monthly Budgets cost alert. Every
# resource is named rc-*, matching exactly what admin-grant-protection.sh's step 3 grants
# rc-deploy (CloudWatch alarms/dashboards and SNS/Budgets rights scoped to rc-* names).

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0"
    }
  }
}

locals {
  name_prefix  = "rc-federal-mcps-${var.environment_tag}"
  has_email    = var.alert_email != null
  alarm_action = [aws_sns_topic.alerts.arn]
}

# --- Alerts: one topic for every alarm, an email subscription only when configured --------

resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = local.has_email ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# --- AWS Budgets: a monthly cost alert on the project=federal-mcps tag ---------------------
# Requires the "project" cost-allocation tag active in Billing (admin-grant-protection.sh
# step 4). No email means no notification, so this budget just tracks spend silently.

resource "aws_budgets_budget" "monthly_cost" {
  name         = "${local.name_prefix}-monthly-cost"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_amount_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:project$federal-mcps"]
  }

  dynamic "notification" {
    for_each = local.has_email ? [1] : []
    content {
      comparison_operator        = "GREATER_THAN"
      notification_type          = "ACTUAL"
      threshold                  = 80
      threshold_type             = "PERCENTAGE"
      subscriber_email_addresses = [var.alert_email]
    }
  }
}

# --- Alarms ----------------------------------------------------------------------------------

# 1-2. The BLS service budget, warning and critical (ADR-020 §5: "BLS budget ≥ 80%").
# ServiceBudgetUsedPct is already a percentage (http/client.ts's noteNearLimit-adjacent
# metric), so the alarm needs no knowledge of the configured daily limit.
resource "aws_cloudwatch_metric_alarm" "bls_budget_warning" {
  alarm_name          = "${local.name_prefix}-bls-budget-warning"
  alarm_description   = "BLS's service-wide upstream budget has reached ${var.bls_budget_warning_pct}% of today's limit."
  namespace           = "FederalMCPs"
  metric_name         = "ServiceBudgetUsedPct"
  dimensions          = { source = "bls" }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.bls_budget_warning_pct
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_action
  ok_actions          = local.alarm_action
}

resource "aws_cloudwatch_metric_alarm" "bls_budget_critical" {
  alarm_name          = "${local.name_prefix}-bls-budget-critical"
  alarm_description   = "BLS's service-wide upstream budget has reached ${var.bls_budget_critical_pct}% of today's limit: new queries are being refused."
  namespace           = "FederalMCPs"
  metric_name         = "ServiceBudgetUsedPct"
  dimensions          = { source = "bls" }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.bls_budget_critical_pct
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_action
  ok_actions          = local.alarm_action
}

# 3. A refusal spike, summed across every server and limit scope (ADR-020 §5's spike
# suggestion: "over 50 in an hour"). CloudWatch alarms reject SEARCH() ("SEARCH is not
# supported in alarms" — only dashboards may use it), so this uses a Metrics Insights query
# instead, which alarms DO support and which covers every {server,limitScope} series (up to
# 15 here) in one query without needing a metric_query per series.
resource "aws_cloudwatch_metric_alarm" "refusal_spike" {
  alarm_name          = "${local.name_prefix}-refusal-spike"
  alarm_description   = "More than ${var.refusal_spike_threshold} tool calls were refused (any server, any scope) in the last hour."
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.refusal_spike_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_action
  ok_actions          = local.alarm_action

  metric_query {
    id          = "refusals_total"
    return_data = true
    period      = 3600
    expression  = "SELECT SUM(Refusals) FROM SCHEMA(FederalMCPs, limitScope, server)"
    label       = "Refusals (all servers, all scopes)"
  }
}

# 4. One Errors alarm per EMF-emitting server (ADR-020 §5: "the error rate per server").
resource "aws_cloudwatch_metric_alarm" "errors_per_server" {
  for_each = toset(var.services)

  alarm_name          = "${local.name_prefix}-errors-${each.value}"
  alarm_description   = "${each.value}: more than ${var.error_rate_threshold} tool-call errors in 15 minutes."
  namespace           = "FederalMCPs"
  metric_name         = "Errors"
  dimensions          = { server = each.value }
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.error_rate_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_action
  ok_actions          = local.alarm_action
}

# 5. limiter_degraded > 0 (ADR-020 §5, #326): EMF on the existing log line
# (persistent-limiter.ts), a dimensionless family-wide count — no Terraform Logs metric
# filter, and so no new IAM beyond what admin-grant-protection.sh already grants.
resource "aws_cloudwatch_metric_alarm" "limiter_degraded" {
  alarm_name          = "${local.name_prefix}-limiter-degraded"
  alarm_description   = "The persistent limiter's store failed at least once in the last 5 minutes (ADR-020 §3: shares failed open, the service budget fell back to an in-memory counter)."
  namespace           = "FederalMCPs"
  metric_name         = "LimiterDegraded"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_action
  ok_actions          = local.alarm_action
}

# 6-7. Lambda Throttles/Errors > 0, summed across every family function (ADR-020 §5: "the
# edge is being hit, so someone is hammering or the ceiling is too low"). Free AWS/Lambda
# metrics, not EMF, so this covers the CDC portal too. CloudWatch alarms reject SEARCH(), so
# the sum is built from explicit metric math instead: one metric_query per function
# (return_data = false) plus one sum expression (return_data = true) — a single alarm
# allows up to 10 metrics, and `lambda_function_names`'s validation caps the list at 9 so
# the function-count-plus-one-sum total can never exceed that.
locals {
  lambda_metric_ids     = [for i in range(length(var.lambda_function_names)) : "m${i}"]
  lambda_sum_expression = join("+", local.lambda_metric_ids)
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  count = length(var.lambda_function_names) > 0 ? 1 : 0

  alarm_name          = "${local.name_prefix}-lambda-throttles"
  alarm_description   = "At least one family Lambda throttled in the last 5 minutes."
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_action
  ok_actions          = local.alarm_action

  dynamic "metric_query" {
    for_each = { for i, name in var.lambda_function_names : "m${i}" => name }
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = "AWS/Lambda"
        metric_name = "Throttles"
        dimensions  = { FunctionName = metric_query.value }
        period      = 300
        stat        = "Sum"
      }
    }
  }

  metric_query {
    id          = "total"
    return_data = true
    expression  = local.lambda_sum_expression
    label       = "Throttles (every family Lambda)"
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  count = length(var.lambda_function_names) > 0 ? 1 : 0

  alarm_name          = "${local.name_prefix}-lambda-errors"
  alarm_description   = "At least one family Lambda errored in the last 5 minutes."
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_action
  ok_actions          = local.alarm_action

  dynamic "metric_query" {
    for_each = { for i, name in var.lambda_function_names : "m${i}" => name }
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = "AWS/Lambda"
        metric_name = "Errors"
        dimensions  = { FunctionName = metric_query.value }
        period      = 300
        stat        = "Sum"
      }
    }
  }

  metric_query {
    id          = "total"
    return_data = true
    expression  = local.lambda_sum_expression
    label       = "Errors (every family Lambda)"
  }
}

# --- Dashboard -------------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name_prefix
  dashboard_body = jsonencode({
    widgets = concat(
      [
        {
          type   = "metric"
          x      = 0
          y      = 0
          width  = 12
          height = 6
          properties = {
            title   = "Tool calls per server"
            region  = "us-east-1"
            view    = "timeSeries"
            metrics = [for s in var.services : ["FederalMCPs", "ToolCalls", "server", s]]
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 0
          width  = 12
          height = 6
          properties = {
            title   = "Refusals by scope (every server)"
            region  = "us-east-1"
            view    = "timeSeries"
            metrics = [["FederalMCPs", "Refusals", "server", "bls", "limitScope", "service"]]
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 6
          width  = 12
          height = 6
          properties = {
            title   = "Upstream budget use (BLS, % of today's quota)"
            region  = "us-east-1"
            view    = "timeSeries"
            metrics = [["FederalMCPs", "ServiceBudgetUsedPct", "source", "bls"]]
            yAxis   = { left = { min = 0, max = 100 } }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 6
          width  = 12
          height = 6
          properties = {
            title   = "Errors per server"
            region  = "us-east-1"
            view    = "timeSeries"
            metrics = [for s in var.services : ["FederalMCPs", "Errors", "server", s]]
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 12
          width  = 12
          height = 6
          properties = {
            title   = "Latency per server (ms)"
            region  = "us-east-1"
            view    = "timeSeries"
            metrics = [for s in var.services : ["FederalMCPs", "LatencyMs", "server", s]]
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 12
          width  = 12
          height = 6
          properties = {
            title   = "Lambda throttles (every family function)"
            region  = "us-east-1"
            view    = "timeSeries"
            metrics = [for n in var.lambda_function_names : ["AWS/Lambda", "Throttles", "FunctionName", n]]
          }
        },
      ],
    )
  })
}
