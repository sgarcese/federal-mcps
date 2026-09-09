# One-time, per-account bootstrap of the Terraform state backend (ADR-005 §1, §3).
#
# Run by a person with AWS_PROFILE=rc-deploy, once per instance account, before the
# first deploy. Uses local state on purpose: this configuration creates the remote
# backend the instance roots use, so it cannot use that backend itself.
#
#   cd terraform/bootstrap
#   terraform init
#   terraform apply -var-file=../instances/dev/bootstrap.auto.tfvars.json
#
# Locking uses S3's native lockfile (Terraform >= 1.10); no DynamoDB table.

terraform {
  required_version = ">= 1.10"

  backend "local" {
    path = "terraform.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.63.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project     = "federal-mcps"
      environment = var.environment_tag
      managed_by  = "terraform/bootstrap"
    }
  }
}

locals {
  bucket_name = "federal-mcps-tfstate-${var.account_id}"
}

resource "aws_s3_bucket" "state" {
  bucket = local.bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
