variable "account_id" {
  description = "AWS account id (from the instance record)."
  type        = string
}

variable "region" {
  description = "Region the stacks deploy to (from the instance record)."
  type        = string
}

variable "role_name" {
  description = "Name of the deploy role. Must match the instance record's deployRoleArn."
  type        = string
  default     = "rc-federal-mcps-github-deploy-role"
}

variable "github_owner" {
  description = "GitHub owner login."
  type        = string
  default     = "sgarcese"
}

variable "github_owner_id" {
  description = "GitHub owner numeric id (immutable)."
  type        = number
  default     = 2701478
}

variable "github_repo" {
  description = "GitHub repository name."
  type        = string
  default     = "federal-mcps"
}

variable "github_repo_id" {
  description = "GitHub repository numeric id (immutable)."
  type        = number
  default     = 1361995308
}

variable "state_bucket" {
  description = "Pre-existing Terraform state bucket (rc-tfstate-<account>) the role may read and write."
  type        = string
}

variable "state_key_prefix" {
  description = "Key prefix inside the state bucket this project owns, e.g. rc/federal-mcps/."
  type        = string
  default     = "rc/federal-mcps/"
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone the role may change records in (from the instance record)."
  type        = string
}
