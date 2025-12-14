resource "aws_cloudwatch_log_group" "notifier" {
  count = var.notifications_enabled == "NONE" ? 0 : 1

  name = "/aws/lambda/retainless-notifier"
  retention_in_days = 14
}

resource "aws_sns_topic" "notifier" {
  count = var.notifications_enabled == "NONE" ? 0 : 1

  name = "retainless-log-processor-results"
}

resource "aws_cloudwatch_log_metric_filter" "notifier" {
  count = var.notifications_enabled == "NONE" ? 0 : 1

  log_group_name = aws_cloudwatch_log_group.log_processor.name
  name = "retainless-log-processor-notifications"
  pattern = var.notifications_enabled == "ERROR" ? "Invoke Error" : "END RequestId"

  metric_transformation {
    name = "EventCount"
    namespace = "RetainlessLogProcessor"
    value = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "notifier" {
  count = var.notifications_enabled == "NONE" ? 0 : 1

  alarm_name = "retainless-log-processor-notification-event"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods = 1
  metric_name = aws_cloudwatch_log_metric_filter.notifier[0].metric_transformation[0].name
  namespace = aws_cloudwatch_log_metric_filter.notifier[0].metric_transformation[0].namespace
  period = 60
  statistic = "Sum"
  threshold = 1
  alarm_actions = [
    aws_lambda_function.notifier[0].arn
  ]
}

resource "aws_lambda_function" "notifier" {
  count = var.notifications_enabled == "NONE" ? 0 : 1

  function_name = "retainless-notifier"
  role = aws_iam_role.retainless.arn

  filename = local.lambda_file
  source_code_hash = local.lambda_file_sha256
  runtime = "nodejs22.x"
  handler = "notifier.handler"
  timeout = 30
  memory_size = 128

  logging_config {
    log_format = "Text"
    log_group = aws_cloudwatch_log_group.notifier[0].name
  }

  environment {
    variables = {
      NOTIFICATION_TOPIC_ARN = aws_sns_topic.notifier[0].arn,
      LOG_GROUP_ARN = aws_cloudwatch_log_group.log_processor.arn,
    }
  }
}

output "notifications_topic_arn" {
  value = length(aws_sns_topic.notifier) > 0 ? aws_sns_topic.notifier[0].arn : ""
}
