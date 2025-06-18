terraform {
  backend "s3" {
    bucket         = "remote-backend-s3-giabao22520120"
    key            = "common/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "remote-backend-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

# Tạo VPC..
module "vpc" {
  source = "../modules/vpc"

  vpc_name           = "${var.project_name}-vpc"
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
  private_subnets    = var.private_subnets
  public_subnets     = var.public_subnets

  tags = {
    Project   = var.project_name
    ManagedBy = "Terraform"
  }
}

#Tạo EKS cluster
module "eks" {
  source = "../modules/eks"

  cluster_name           = "${var.project_name}-eks"
  vpc_id                 = module.vpc.vpc_id
  vpc_private_subnet_ids = module.vpc.private_subnets

  tags = {
    Project     = var.project_name
    ManagedBy   = "Terraform"
    Application = "Product Traceability"
  }
}
