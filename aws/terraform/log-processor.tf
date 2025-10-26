data "http" "log_processor" {
  url = "https://github.com/retainless/retainless-collector/releases/download/v0.1.0/aws.zip"

  lifecycle {
    postcondition {
      condition = contains([200], self.status_code)
      error_message = "Status code invalid"
    }
  }
}

resource "local_file" "log_processor" {
  content_base64 = data.http.log_processor.response_body_base64
  filename = "${path.cwd}/build/aws-log-processor.zip"
}

resource "aws_cloudwatch_log_group" "log_processor" {
  name = "/aws/lambda/retainless-log-processor"
  retention_in_days = 14
}

resource "aws_iam_role_policy_attachment" "execution" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role = aws_iam_role.retainless.name
}

resource "aws_lambda_function" "log_processor" {
  function_name = "retainless-log-processor"
  role = aws_iam_role.retainless.arn

  filename = local_file.log_processor.filename
  source_code_hash = local_file.log_processor.content_sha256
  runtime = "nodejs22.x"
  handler = "lambda.handler"
  timeout = 300
  memory_size = 128

  logging_config {
    log_format = "Text"
    log_group = aws_cloudwatch_log_group.log_processor.name
  }

  environment {
    variables = {
      DYNAMODB_TABLE_PERIODS = aws_dynamodb_table.periods.name,
      DYNAMODB_TABLE_USERS = aws_dynamodb_table.users.name,
      LOG_GROUP_ARN = var.log_group_arn,
      LOG_STREAM_NAME = var.log_stream_name,
      TZ = var.timezone,

      # APPLICATION_ID = "retainless-app",
      # LOG_MAX_DURATION = "3600"
      # PERIOD_EXPIRATION = "30"
    }
  }
}
