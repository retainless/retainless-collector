module "retainless" {
  source = "../terraform"

  log_group_arn = "arn:aws:logs:us-east-1:904233117841:log-group:/aws/lambda/retainless-log-processor:*"
}
