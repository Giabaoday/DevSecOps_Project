variable "function_name" {
  description = "Name of the Lambda function"
  type        = string
}

variable "description" {
  description = "Description of the Lambda function"
  type        = string
  default     = ""
}

variable "handler" {
  description = "Lambda function handler"
  type        = string
}

variable "runtime" {
  description = "Lambda runtime"
  type        = string
  default     = "nodejs20.x"
}

variable "s3_bucket" {
  description = "S3 bucket containing Lambda deployment packages"
  type        = string
}

variable "app_version" {
  description = "Version of the Lambda package"
  type        = string
  default     = "latest"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "dynamodb_table" {
  description = "DynamoDB table name"
  type        = string
}

variable "dynamodb_arn" {
  description = "DynamoDB table ARN"
  type        = string
}

variable "timeout" {
  description = "Lambda function timeout"
  type        = number
  default     = 30
}

variable "memory_size" {
  description = "Lambda function memory size"
  type        = number
  default     = 256
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention period"
  type        = number
  default     = 7
}

variable "reserved_concurrency" {
  description = "Reserved concurrent executions"
  type        = number
  default     = -1 # -1 means no specific limit
}

variable "additional_environment_variables" {
  description = "Additional environment variables"
  type        = map(string)
  default     = {}
}

variable "additional_policy_statements" {
  description = "Additional IAM policy statements"
  type        = any
  default     = {}
}

variable "additional_iam_policies" {
  description = "Additional IAM policy ARNs to attach to Lambda"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags for Lambda function"
  type        = map(string)
  default     = {}
}
