terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.16"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

variable "log_group_arn" {
  type = string
  description = "AWS CloudWatch Log Group ARN with access logs (currently CloudFront v2 standard format)"
}

variable "log_stream_name" {
  type = string
  default = ""
  description = "Optional filter to limit one specific Log Stream within the Log Group"
}

variable "timezone" {
  type = string
  default = "America/Chicago"
  description = "Timezone used for determining end-of-day processing schedule"
}
