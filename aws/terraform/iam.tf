resource "aws_iam_role" "retainless" {
  name = "retainless-analytics-lambda"

  assume_role_policy = <<EOF
{
  "Version": "2008-10-17",
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": [
          "lambda.amazonaws.com",
          "scheduler.amazonaws.com"
        ]
      },
      "Effect": "Allow"
    }
  ]
}
EOF
}

resource "aws_iam_role_policy_attachment" "lambda_execution" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role = aws_iam_role.retainless.name
}

resource "aws_iam_role_policy" "sync" {
  role = aws_iam_role.retainless.name

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "lambda:InvokeFunction"
        ],
        Resource = aws_lambda_function.log_processor.arn
      },
      {
        Effect = "Allow",
        Action = [
          "dynamodb:Scan",
          "dynamodb:Query",
          "dynamodb:PutItem",
          "dynamodb:BatchWriteItem"
        ],
        Resource = [
          aws_dynamodb_table.periods.arn,
          aws_dynamodb_table.users.arn,
          "${aws_dynamodb_table.users.arn}/index/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:StartQuery",
          "logs:GetQueryResults",
        ],
        Resource = [
          var.log_group_arn
        ]
      }, {
        // https://stackoverflow.com/questions/62085074/cloud-watch-log-access-to-an-iam-user-for-only-only-one-specific-log-group#comment109826709_62085074
        Effect = "Allow",
        Action = "logs:DescribeLogGroups",
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "notifier" {
  count = var.notifications_enabled == "NONE" ? 0 : 1

  role   = aws_iam_role.retainless.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:GetLogEvents",
        ],
        Resource = [
          "${aws_cloudwatch_log_group.log_processor.arn}:*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "sns:Publish",
        ],
        Resource = [
          aws_sns_topic.notifier[0].arn
        ]
      }
    ]
  })
}
