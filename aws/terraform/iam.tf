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
          "dynamodb:Scan",
          "dynamodb:Query",
          "dynamodb:PutItem",
        ],
        Resource = [
          aws_dynamodb_table.periods.arn,
          aws_dynamodb_table.users.arn,
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
      }
    ]
  })
}
