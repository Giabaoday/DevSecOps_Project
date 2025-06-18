output "dynamodb_table_name" {
  description = "Name of the DynamoDB table"
  value       = module.tracer_table.table_id
}

output "lambda_functions" {
  description = "ARNs of the Lambda functions"
  value       = module.lambda_service.function_arn
}

output "api_gateway_endpoint" {
  description = "API Gateway endpoint URL"
  value       = module.api_gateway.api_endpoint
}

output "s3_buckets" {
  description = "S3 bucket names"
  value = {
    lambda_deployments = module.lambda_deployment_bucket.bucket_name
    frontend_assets    = module.frontend_assets_bucket.bucket_name
  }
}