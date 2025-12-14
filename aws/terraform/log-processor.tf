locals {
  lambda_file_path = "${path.module}/../../packages/log-processor/build/bundles/aws.zip"

  lambda_file = length(local_file.log_processor) > 0 ? local_file.log_processor[0].filename : local.lambda_file_path
  lambda_file_sha256 = length(local_file.log_processor) > 0 ? local_file.log_processor[0].content_sha256 : filesha256(local.lambda_file_path)
}

data "http" "log_processor" {
  count = fileexists(local.lambda_file_path) ? 0 : 1

  url = "https://github.com/retainless/retainless-collector/releases/download/v0.1.1/aws.zip"

  lifecycle {
    postcondition {
      condition = contains([200], self.status_code)
      error_message = "Status code invalid"
    }
  }
}

resource "local_file" "log_processor" {
  count = length(data.http.log_processor) > 0 ? 1 : 0

  content_base64 = data.http.log_processor[0].response_body_base64
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

  filename = local.lambda_file
  source_code_hash = local.lambda_file_sha256
  runtime = "nodejs22.x"
  handler = "lambda.handler"
  timeout = 300
  memory_size = 512

  logging_config {
    log_format = "Text"
    log_group = aws_cloudwatch_log_group.log_processor.name
  }

  environment {
    variables = merge({
      DYNAMODB_TABLE_PERIODS = aws_dynamodb_table.periods.name,
      DYNAMODB_TABLE_USERS = aws_dynamodb_table.users.name,
      LOG_GROUP_ARN = var.log_group_arn,
      LOG_STREAM_NAME = var.log_stream_name,
      TZ = var.timezone,

      # APPLICATION_ID = "retainless-app",
      # PERIOD_EXPIRATION = "30"
    }, var.log_scan_duration > 0 ? {
      LOG_MAX_DURATION = var.log_scan_duration
    } : {})
  }
}
