terraform {
  backend "s3" {
    bucket         = "remote-backend-s3-giabao22520120"
    key            = "environments/prod/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "remote-backend-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_secretsmanager_secret" "blockchain_secrets" {
  name = var.blockchain_secrets_name
}

data "aws_secretsmanager_secret_version" "blockchain_secrets" {
  secret_id = data.aws_secretsmanager_secret.blockchain_secrets.id
}

# Tạo S3 buckets
module "lambda_deployment_bucket" {
  source = "../../modules/s3"

  bucket_name = "${var.project_name}-lambda-deployments-${var.environment}"
}

module "frontend_assets_bucket" {
  source = "../../modules/s3"

  bucket_name = "${var.project_name}-frontend-assets-${var.environment}"
}

# Tạo DynamoDB table
module "tracer_table" {
  source = "../../modules/dynamodb_table"

  table_name = "${var.project_name}-data-${var.environment}"

  tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "Terraform"
  }
}

resource "aws_iam_policy" "lambda_secrets_policy" {
  name        = "lambda-secrets-policy-${var.environment}"
  description = "Allow Lambda to access Secrets Manager"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = data.aws_secretsmanager_secret.blockchain_secrets.arn
      }
    ]
  })
}

module "lambda_service" {
  source = "../../modules/lambda"

  function_name = "lambda_service"
  description   = "Service for product tracer application"
  handler       = "index.handler"
  runtime       = "nodejs20.x"

  s3_bucket   = module.lambda_deployment_bucket.bucket_name
  app_version = var.app_version
  environment = var.environment
  region      = var.aws_region

  dynamodb_table = module.tracer_table.table_id
  dynamodb_arn   = module.tracer_table.table_arn

  additional_environment_variables = {
    COGNITO_USER_POOL       = var.cognito_user_pool_id
    COGNITO_CLIENT_ID       = var.cognito_client_id
    BLOCKCHAIN_SECRETS_NAME = var.blockchain_secrets_name
  }

  additional_iam_policies = [
    aws_iam_policy.lambda_secrets_policy.arn
  ]

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# Tạo API Gateway
module "api_gateway" {
  source = "../../modules/api_gateway"

  environment = var.environment
  api_name    = "${var.project_name}-api"
  aws_region  = var.aws_region

  # Cognito config
  cognito_user_pool_id     = var.cognito_user_pool_id
  cognito_client_id        = var.cognito_client_id
  cognito_user_pool        = { id = var.cognito_user_pool_id }
  cognito_user_pool_client = { id = var.cognito_client_id }

  # Updated routes cho blockchain traceability system
  routes = {
    # 👤 User Management Routes
    "GET /users/me" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    "POST /users/update-role" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    # 🏭 Product Management Routes (Blockchain Integration)
    "GET /products" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    "POST /products" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    "GET /products/{id}" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    "PUT /products/{id}" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    "DELETE /products/{id}" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    # 📦 Order Management Routes
    "GET /orders" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    "POST /orders" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    "PUT /orders/{id}" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    # 🔍 Blockchain Verification & Tracing Routes
    "GET /verify" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    "GET /trace" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    # 🏢 Company Management Routes
    "GET /manufacturers" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    "GET /retailers" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = "cognito"
    }

    # 🌐 Public Routes (No Authentication Required)
    "GET /public/verify" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = null
    }

    "GET /public/trace" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = null
    }

    # 📊 Health Check Route
    "GET /health" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = null
    }

    # 🔧 CORS Options Routes (Required for frontend)
    "OPTIONS /{proxy+}" = {
      integration = {
        uri                    = module.lambda_service.lambda_function_arn
        payload_format_version = "2.0"
      }
      authorizer_key = null
    }
  }

  # Lambda permissions
  lambda_permissions = {
    "lambda_service" = module.lambda_service.lambda_function_name
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
    Purpose     = "Blockchain Traceability API"
  }
}
