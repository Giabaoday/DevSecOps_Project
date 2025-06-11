module "lambda_function" {
  source  = "terraform-aws-modules/lambda/aws"
  version = "7.20.2"

  function_name = "${var.function_name}-${var.environment}"
  description   = var.description
  handler       = var.handler
  runtime       = var.runtime

  create_package = false

  s3_existing_package = {
    bucket = var.s3_bucket
    key    = "lambda-packages/${var.function_name}-${var.app_version}.zip"
  }

  environment_variables = merge(
    {
      NODE_ENV       = var.environment
      DYNAMODB_TABLE = var.dynamodb_table
      REGION         = var.region
    },
    var.additional_environment_variables
  )

  attach_policy_statements = true
  policy_statements = merge(
    {
      dynamodb = {
        effect = "Allow",
        actions = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ],
        resources = [var.dynamodb_arn, "${var.dynamodb_arn}/index/*"]
      }
    },
    var.additional_policy_statements
  )

  # Attach additional IAM policies if provided
  attach_policies    = length(var.additional_iam_policies) > 0
  policies           = var.additional_iam_policies
  number_of_policies = length(var.additional_iam_policies)

  timeout     = var.timeout
  memory_size = var.memory_size

  cloudwatch_logs_retention_in_days = var.log_retention_days
  reserved_concurrent_executions    = var.reserved_concurrency

  tags = merge(
    var.tags,
    {
      Function = var.function_name
    }
  )
}
