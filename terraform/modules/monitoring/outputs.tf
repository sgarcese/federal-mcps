output "dashboard_name" {
  value = aws_cloudwatch_dashboard.main.dashboard_name
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "has_email_subscription" {
  value = length(aws_sns_topic_subscription.alerts_email) > 0
}

output "budget_name" {
  value = aws_budgets_budget.monthly_cost.name
}

output "alarm_names" {
  description = "Every alarm this module created, for the instance root's own assertions."
  value = concat(
    [
      aws_cloudwatch_metric_alarm.bls_budget_warning.alarm_name,
      aws_cloudwatch_metric_alarm.bls_budget_critical.alarm_name,
      aws_cloudwatch_metric_alarm.refusal_spike.alarm_name,
      aws_cloudwatch_metric_alarm.limiter_degraded.alarm_name,
    ],
    [for a in aws_cloudwatch_metric_alarm.errors_per_server : a.alarm_name],
    [for a in aws_cloudwatch_metric_alarm.lambda_throttles : a.alarm_name],
    [for a in aws_cloudwatch_metric_alarm.lambda_errors : a.alarm_name],
  )
}
