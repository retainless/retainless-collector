resource "aws_dynamodb_table" "periods" {
  name = "retainless-db-periods"

  billing_mode = "PAY_PER_REQUEST"

  hash_key = "applicationId"
  range_key = "periodEnd"

  attribute {
    name = "applicationId"
    type = "S"
  }

  attribute {
    name = "periodEnd"
    type = "S"
  }

  ttl {
    attribute_name = "periodExpires"
    enabled = true
  }
}

resource "aws_dynamodb_table" "users" {
  name = "retainless-db-users"

  billing_mode = "PAY_PER_REQUEST"

  hash_key = "userId"
  range_key = "periodId"

  attribute {
    name = "periodId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    hash_key = "periodId"
    name = "RetentionForPeriod"
    projection_type = "ALL"
  }
}
