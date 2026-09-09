# Root module for the `dev` instance (ADR-005 §1). One directory per fleet-record
# instance; every value comes from instances.json through locals.tf.
#
# First apply (bootstrap runbook, a person with AWS_PROFILE=rc-deploy):
#   terraform init
#   terraform apply -target=module.github_oidc_deploy_role
# Every later apply is CI (deploy.yml, #10) assuming that role.

terraform {
  required_version = ">= 1.10"

  backend "s3" {
    # Bucket and region cannot be expressions here; they are passed at init by
    # `scripts/tf-backend-config.mjs` from instances.json, so they are still not
    # written anywhere but the fleet record. See backend.tf for the shape.
    key          = "instances/dev/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.63.0"
    }
  }
}

provider "aws" {
  region = local.instance.region

  default_tags {
    tags = {
      project     = "federal-mcps"
      environment = local.instance.environmentTag
      managed_by  = "terraform/instances/${local.instance.name}"
    }
  }
}

module "github_oidc_deploy_role" {
  source = "../../modules/github-oidc-deploy-role"

  account_id     = local.instance.account
  region         = local.instance.region
  role_name      = local.deploy_role_name
  state_bucket   = local.state_bucket
  hosted_zone_id = local.instance.domain.hostedZoneId
}

# The zip is a real build artifact (packages/server-bls/dist/lambda.zip, from
# `npm run bundle -w packages/server-bls`), not something Terraform produces;
# this variable exists (rather than a literal path in the module block) so
# the root's own test can point `filebase64sha256` at the bls-server module's
# committed placeholder zip instead, without needing a real bundle first.
variable "bls_lambda_zip_path" {
  description = "Path to the BLS Lambda's esbuild bundle zip."
  type        = string
  default     = "../../../packages/server-bls/dist/lambda.zip"
}

module "bls_server" {
  source = "../../modules/bls-server"

  lambda_zip_path = var.bls_lambda_zip_path
  domain_name     = local.instance.domain.blsDomainName
  hosted_zone_id  = local.instance.domain.hostedZoneId
  secret_name     = local.instance.secrets.bls
  environment_tag = local.instance.environmentTag
}
