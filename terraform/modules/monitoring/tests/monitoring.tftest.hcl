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

run "refusal_spike_alarm_uses_a_metrics_insights_query_not_search" {
  command = plan

  # CloudWatch alarms reject SEARCH() ("SEARCH is not supported in alarms"); only dashboards
  # may use it. Metrics Insights (a SQL-like SELECT) IS supported in alarms, and one query
  # covers every {server,limitScope} series without hitting the 10-metric-per-alarm cap that
  # explicit metric math would (up to 15 series here).
  assert {
    condition     = aws_cloudwatch_metric_alarm.refusal_spike.threshold == 50
    error_message = "the refusal spike threshold must default to 50 (spike's question-4 suggestion)"
  }
  assert {
    condition     = one(aws_cloudwatch_metric_alarm.refusal_spike.metric_query).expression != null
    error_message = "the refusal spike alarm must use a metric_query"
  }
  assert {
    condition     = startswith(one(aws_cloudwatch_metric_alarm.refusal_spike.metric_query).expression, "SELECT")
    error_message = "the refusal spike alarm's expression must be a Metrics Insights SELECT, not a SEARCH()"
  }
  assert {
    condition     = strcontains(one(aws_cloudwatch_metric_alarm.refusal_spike.metric_query).expression, "SUM(Refusals)")
    error_message = "the refusal spike query must sum the Refusals metric"
  }
  assert {
    condition     = strcontains(one(aws_cloudwatch_metric_alarm.refusal_spike.metric_query).expression, "SCHEMA(FederalMCPs, limitScope, server)")
    error_message = "the refusal spike query must select from the FederalMCPs schema keyed on limitScope and server"
  }
  assert {
    condition     = one(aws_cloudwatch_metric_alarm.refusal_spike.metric_query).period == 3600
    error_message = "the refusal spike query must run over a one-hour period"
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

run "lambda_throttles_and_errors_alarms_use_metric_math_not_search" {
  command = plan

  # CloudWatch alarms reject SEARCH(); explicit metric math (one metric_query per function,
  # dimensioned by FunctionName, plus a sum expression) is supported and fits the 10-metric
  # alarm cap with 6 functions.
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.lambda_throttles) == 1
    error_message = "with lambda_function_names set, the throttles alarm must be created"
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.lambda_errors) == 1
    error_message = "with lambda_function_names set, the errors alarm must be created"
  }

  # One metric_query per function (return_data = false) plus one sum expression
  # (return_data = true): 6 functions here means 7 metric_query blocks.
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.lambda_throttles[0].metric_query) == length(var.lambda_function_names) + 1
    error_message = "the throttles alarm must have one metric_query per function plus one sum expression"
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.lambda_errors[0].metric_query) == length(var.lambda_function_names) + 1
    error_message = "the errors alarm must have one metric_query per function plus one sum expression"
  }

  # Exactly one metric_query returns data: the sum expression.
  assert {
    condition     = length([for q in aws_cloudwatch_metric_alarm.lambda_throttles[0].metric_query : q if q.return_data]) == 1
    error_message = "exactly one metric_query (the sum) must have return_data = true"
  }
  assert {
    condition     = length([for q in aws_cloudwatch_metric_alarm.lambda_throttles[0].metric_query : q if q.expression != null && q.expression != ""]) == 1
    error_message = "exactly one metric_query (the sum) may carry an expression; the rest must be plain metric queries"
  }

  # Every per-function query watches FunctionName, dimensioned, never a SEARCH.
  assert {
    condition = alltrue([
      for q in aws_cloudwatch_metric_alarm.lambda_throttles[0].metric_query :
      !strcontains(coalesce(q.expression, ""), "SEARCH(")
    ])
    error_message = "no metric_query in the throttles alarm may use SEARCH()"
  }
  assert {
    condition = alltrue([
      for q in aws_cloudwatch_metric_alarm.lambda_errors[0].metric_query :
      !strcontains(coalesce(q.expression, ""), "SEARCH(")
    ])
    error_message = "no metric_query in the errors alarm may use SEARCH()"
  }

  # The CDC portal's function is one of the per-function metrics (AWS/Lambda metrics reach
  # it; the core EMF line does not).
  assert {
    condition = anytrue([
      for q in aws_cloudwatch_metric_alarm.lambda_throttles[0].metric_query :
      length(q.metric) > 0 && q.metric[0].dimensions["FunctionName"] == "rc-cdc-mcp-dev"
    ])
    error_message = "the throttles alarm must cover the CDC portal's function too"
  }
}

run "no_alarm_expression_uses_search" {
  command = plan

  # The deploy blocker this guards against: "SEARCH is not supported in alarms" — only
  # dashboards may use SEARCH(). Checked across every alarm's every metric_query.
  assert {
    condition = alltrue(flatten([
      for alarm_queries in [
        aws_cloudwatch_metric_alarm.refusal_spike.metric_query,
        aws_cloudwatch_metric_alarm.lambda_throttles[0].metric_query,
        aws_cloudwatch_metric_alarm.lambda_errors[0].metric_query,
        ] : [
        for q in alarm_queries : !strcontains(coalesce(q.expression, ""), "SEARCH(")
      ]
    ]))
    error_message = "no aws_cloudwatch_metric_alarm metric_query may use SEARCH() — AWS rejects it at apply time"
  }
}

run "lambda_function_names_rejects_more_than_nine" {
  command = plan

  variables {
    lambda_function_names = [
      "f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9",
    ]
  }

  expect_failures = [
    var.lambda_function_names,
  ]
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
