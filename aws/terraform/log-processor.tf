data "archive_file" "log_processor" {
  type = "zip"
  output_path = "${path.cwd}/build/log-processor-aws.zip"
  source_dir = "${path.module}/../../build/log-processor-aws"
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

  filename = data.archive_file.log_processor.output_path
  source_code_hash = data.archive_file.log_processor.output_base64sha256
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
      APPLICATION_ID = "retainless-app",
      LOG_GROUP_ARN = var.log_group_arn,
      LOG_STREAM_NAME = var.log_stream_name,
      PERIOD_LENGTH = "7"
      PERIOD_EXPIRATION = "4"
    }
  }
}
