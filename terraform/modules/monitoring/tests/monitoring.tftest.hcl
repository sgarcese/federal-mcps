# The monitoring module (#326, ADR-020 §5): the dashboard, the ~ten alarms, the SNS topic
# and the budget, offline against a mocked provider (ADR-005 §2).

mock_provider "aws" {}

variables {
  environment_tag = "dev"
  lambda_function_names = [
    "rc-bls-mcp-dev",
    "rc-census-mcp-dev",
    "rc-huduser-mcp-dev",
    "rc-bea-mcp-dev",
    "rc-geo-mcp-dev",
    "rc-cdc-mcp-dev",
  ]
}

run "every_resource_is_named_rc_star" {
  command = plan

  assert {
    condition     = aws_sns_topic.alerts.name == "rc-federal-mcps-dev-alerts"
    error_message = "the alerts topic must be named rc-federal-mcps-<env>-alerts"
  }
  assert {
    condition     = aws_cloudwatch_dashboard.main.dashboard_name == "rc-federal-mcps-dev"
    error_message = "the dashboard must be named rc-federal-mcps-<env>"
  }
  assert {
    condition     = aws_budgets_budget.monthly_cost.name == "rc-federal-mcps-dev-monthly-cost"
    error_message = "the budget must be named rc-federal-mcps-<env>-monthly-cost"
  }
  assert {
    condition     = alltrue([for n in output.alarm_names : startswith(n, "rc-federal-mcps-dev-")])
    error_message = "every alarm name must start with rc-federal-mcps-<env>- (admin-grant-protection.sh scopes rc-deploy to rc-* alarm names)"
  }
}

run "no_email_means_no_subscription_and_no_budget_notification" {
  command = plan

  assert {
    condition     = length(aws_sns_topic_subscription.alerts_email) == 0
    error_message = "with no alert_email, no SNS subscription must be created"
  }
  assert {
    condition     = length(aws_budgets_budget.monthly_cost.notification) == 0
    error_message = "with no alert_email, the budget must carry no notification block"
  }
}

run "an_email_creates_the_subscription_and_the_budget_notification" {
  command = plan

  variables {
    alert_email = "owner@example.com"
  }

  assert {
    condition     = length(aws_sns_topic_subscription.alerts_email) == 1
    error_message = "an alert_email must create exactly one SNS subscription"
  }
  assert {
    condition     = aws_sns_topic_subscription.alerts_email[0].endpoint == "owner@example.com"
    error_message = "the subscription must use the configured email"
  }
  assert {
    condition     = length(aws_budgets_budget.monthly_cost.notification) == 1
    error_message = "an alert_email must add a budget notification"
  }
  assert {
    condition     = [for n in aws_budgets_budget.monthly_cost.notification : n.subscriber_email_addresses][0] == toset(["owner@example.com"])
    error_message = "the budget notification must email the configured address"
  }
}

run "budget_amount_defaults_to_50_usd_and_is_overridable" {
  command = plan

  assert {
    condition     = aws_budgets_budget.monthly_cost.limit_amount == "50"
    error_message = "the budget amount must default to $50 (and say so, per CLAUDE.md)"
  }
}

run "budget_amount_override" {
  command = plan

  variables {
    budget_amount_usd = 120
  }

  assert {
    condition     = aws_budgets_budget.monthly_cost.limit_amount == "120"
    error_message = "an override must change the budget's limit_amount"
  }
}

run "bls_budget_alarms_default_to_80_and_100_pct" {
  command = plan

  assert {
    condition     = aws_cloudwatch_metric_alarm.bls_budget_warning.threshold == 80
    error_message = "the BLS budget warning alarm must default to 80%"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.bls_budget_warning.metric_name == "ServiceBudgetUsedPct"
    error_message = "the warning alarm must watch ServiceBudgetUsedPct"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.bls_budget_warning.dimensions["source"] == "bls"
    error_message = "the warning alarm must be dimensioned by source=bls"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.bls_budget_critical.threshold == 100
    error_message = "the BLS budget critical alarm must default to 100%"
  }
}

run "refusal_spike_alarm_sums_refusals_across_servers_and_scopes" {
  command = plan

  assert {
    condition     = aws_cloudwatch_metric_alarm.refusal_spike.threshold == 50
    error_message = "the refusal spike threshold must default to 50 (spike's question-4 suggestion)"
  }
  assert {
    condition     = one(aws_cloudwatch_metric_alarm.refusal_spike.metric_query).expression != null
    error_message = "the refusal spike alarm must use a metric_query (a SEARCH expression) rather than a single dimension"
  }
  assert {
    condition     = strcontains(one(aws_cloudwatch_metric_alarm.refusal_spike.metric_query).expression, "Refusals")
    error_message = "the refusal spike alarm's expression must reference the Refusals metric"
  }
}

run "one_errors_alarm_per_emf_emitting_service" {
  command = plan

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.errors_per_server) == 5
    error_message = "there must be one Errors alarm per default service (bls, census, hud, bea, geo)"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.errors_per_server["bls"].dimensions["server"] == "bls"
    error_message = "the bls errors alarm must be dimensioned by server=bls"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.errors_per_server["bls"].threshold == 10
    error_message = "the default error-rate threshold must be 10"
  }
}

run "limiter_degraded_alarm_watches_the_dimensionless_count" {
  command = plan

  assert {
    condition     = aws_cloudwatch_metric_alarm.limiter_degraded.metric_name == "LimiterDegraded"
    error_message = "must watch the LimiterDegraded metric (EMF on persistent-limiter.ts's existing line, #326)"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.limiter_degraded.threshold == 0
    error_message = "limiter_degraded must alarm on any occurrence (> 0)"
  }
}

run "lambda_throttles_and_errors_alarms_cover_every_family_function" {
  command = plan

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.lambda_throttles) == 1
    error_message = "with lambda_function_names set, the throttles alarm must be created"
  }
  assert {
    condition     = strcontains(one(aws_cloudwatch_metric_alarm.lambda_throttles[0].metric_query).expression, "rc-cdc-mcp-dev")
    error_message = "the throttles alarm must cover the CDC portal too (AWS/Lambda metrics reach it; EMF does not)"
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.lambda_errors) == 1
    error_message = "with lambda_function_names set, the errors alarm must be created"
  }
}

run "no_lambda_names_means_no_lambda_alarms" {
  command = plan

  variables {
    lambda_function_names = []
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.lambda_throttles) == 0
    error_message = "with no function names, no throttles alarm should be created"
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.lambda_errors) == 0
    error_message = "with no function names, no errors alarm should be created"
  }
}

run "dashboard_body_references_the_lean_metric_set" {
  command = plan

  assert {
    condition     = strcontains(aws_cloudwatch_dashboard.main.dashboard_body, "ToolCalls")
    error_message = "the dashboard must show calls"
  }
  assert {
    condition     = strcontains(aws_cloudwatch_dashboard.main.dashboard_body, "Refusals")
    error_message = "the dashboard must show refusals"
  }
  assert {
    condition     = strcontains(aws_cloudwatch_dashboard.main.dashboard_body, "ServiceBudgetUsedPct")
    error_message = "the dashboard must show upstream budget use against each quota"
  }
  assert {
    condition     = strcontains(aws_cloudwatch_dashboard.main.dashboard_body, "Errors")
    error_message = "the dashboard must show errors"
  }
  assert {
    condition     = strcontains(aws_cloudwatch_dashboard.main.dashboard_body, "LatencyMs")
    error_message = "the dashboard must show latency"
  }
  assert {
    condition     = strcontains(aws_cloudwatch_dashboard.main.dashboard_body, "Throttles")
    error_message = "the dashboard must show Lambda throttles"
  }
}
