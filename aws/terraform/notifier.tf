resource "aws_cloudwatch_log_group" "notifier" {
  count = var.notifications_enabled == "NONE" ? 0 : 1

  name = "/aws/lambda/retainless-notifier"
  retention_in_days = 14
}

resource "aws_sns_topic" "notifier" {
  count = var.notifications_enabled == "NONE" ? 0 : 1

  name = "retainless-log-processor-results"
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

resource "aws_lambda_permission" "notifier" {
  count = var.notifications_enabled == "NONE" ? 0 : 1

  statement_id = "retainless-notifier-log-stream"
  action = "lambda:InvokeFunction"
  function_name = aws_lambda_function.notifier[0].function_name
  principal = "logs.amazonaws.com"
  source_arn = "${aws_cloudwatch_log_group.log_processor.arn}:*"
}

resource "aws_cloudwatch_log_subscription_filter" "notifier" {
  count = var.notifications_enabled == "NONE" ? 0 : 1

  destination_arn = aws_lambda_function.notifier[0].arn
  filter_pattern  = var.notifications_enabled == "ERROR" ? "Invoke Error" : "END RequestId"
  log_group_name = aws_cloudwatch_log_group.log_processor.name
  name = "retainless-log-processor-notifications"
}

output "notifications_topic_arn" {
  value = length(aws_sns_topic.notifier) > 0 ? aws_sns_topic.notifier[0].arn : ""
}
