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

variable "log_scan_duration" {
  type = number
  default = 0
  description = "Duration in seconds, to chunk AWS CloudWatch Logs queries to limit <10K results (query max)"
}

variable "notifications_enabled" {
  type = string
  default = "NONE"
  description = "Enable SNS Topic for notifications of log processing results (NONE, ERROR, ALL)"
  validation {
    condition = contains(["NONE", "ERROR", "ALL"], var.notifications_enabled)
    error_message = "Valid values are (NONE, ERROR, ALL)"
  }
}
