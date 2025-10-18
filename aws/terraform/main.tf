terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.16"
    }
  }
}

variable "log_group_arn" {
  type = string
}

variable "log_stream_name" {
  type = string
  default = ""
}
