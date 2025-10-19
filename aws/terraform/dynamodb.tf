resource "aws_dynamodb_table" "periods" {
  name = "retainless-db-periods"

  billing_mode = "PAY_PER_REQUEST"

  hash_key = "ApplicationId"
  range_key = "PeriodEnd"

  attribute {
    name = "ApplicationId"
    type = "S"
  }

  attribute {
    name = "PeriodEnd"
    type = "S"
  }

  ttl {
    attribute_name = "PeriodExpires"
    enabled = true
  }
}

resource "aws_dynamodb_table" "users" {
  name = "retainless-db-users"

  billing_mode = "PAY_PER_REQUEST"

  hash_key = "UserId"
  range_key = "PeriodId"

  attribute {
    name = "PeriodId"
    type = "S"
  }

  attribute {
    name = "UserId"
    type = "S"
  }

  global_secondary_index {
    hash_key = "PeriodId"
    name = "RetentionForPeriod"
    projection_type = "INCLUDE"
    non_key_attributes = [
      "UserId",
      "UserIdPeriod",
      "VisitInitial",
      "VisitLatest"
    ]
  }
}
