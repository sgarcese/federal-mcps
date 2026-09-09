# Root module for the `dev` instance (ADR-005 §1). One directory per fleet-record
# instance; every value comes from instances.json through locals.tf.
#
# Deployed locally under AWS_PROFILE=rc-deploy (ADR-007) via scripts/deploy.sh.
# CI validates this root; it never applies it.

terraform {
  required_version = ">= 1.10"

  backend "s3" {
    # Bucket, key and region cannot be expressions here; they are passed at init
    # by `scripts/tf-backend-config.mjs` from instances.json (ADR-006 §1), so they
    # are still not written anywhere but the fleet record. See backend.tf.
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

# ADR-006 §3: the agency key is a sensitive variable, supplied as TF_VAR_bls_api_key
# (CI: from a repository secret; bootstrap: from .env). Never a default, never in git.
variable "bls_api_key" {
  description = "BLS Public Data API key, set on the Lambda as BLS_API_KEY."
  type        = string
  sensitive   = true
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

# The geography Lambda's zip (catalog baked in, ADR-008 §7), from
# `npm run bundle -w packages/server-geo`. Like bls, a variable rather than a literal
# in the module block so the root's own test can point filebase64sha256 at the
# geo-server module's committed placeholder zip without a real bundle first.
variable "geo_lambda_zip_path" {
  description = "Path to the geography Lambda's esbuild bundle zip (catalog baked in)."
  type        = string
  default     = "../../../packages/server-geo/dist/lambda.zip"
}

module "bls_server" {
  source = "../../modules/bls-server"

  service_name    = local.instance.naming.blsService
  lambda_zip_path = var.bls_lambda_zip_path
  domain_name     = local.instance.domain.blsDomainName
  hosted_zone_id  = local.instance.domain.hostedZoneId
  bls_api_key     = var.bls_api_key
  environment_tag = local.instance.environmentTag
}

# The hosted geography server (#58, ADR-008). A separate module instance from
# bls_server (its own Lambda, API and domain), sharing only the fleet record. It
# needs no agency key — its data is the bundled catalog, addressed by GEO_CATALOG_PATH.
module "geo_server" {
  source = "../../modules/geo-server"

  service_name    = local.instance.naming.geoService
  lambda_zip_path = var.geo_lambda_zip_path
  domain_name     = local.instance.domain.geoDomainName
  hosted_zone_id  = local.instance.domain.hostedZoneId
  environment_tag = local.instance.environmentTag
}
