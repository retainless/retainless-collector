resource "aws_scheduler_schedule" "weekly" {
  name = "retainless-log-processor-schedule"
  schedule_expression = "cron(30 1 ? * * *)"
  schedule_expression_timezone = var.timezone

  flexible_time_window {
    mode = "FLEXIBLE"
    maximum_window_in_minutes = 5
  }

  target {
    arn = aws_lambda_function.log_processor.arn
    role_arn = aws_iam_role.retainless.arn
  }
}
