resource "aws_dynamodb_table" "periods" {
  name = "retainless-db-periods"

  billing_mode = "PAY_PER_REQUEST"

  hash_key = "PeriodId"

  attribute {
    name = "PeriodId"
    type = "S"
  }
}
