variable "account_id" {
  description = "AWS account id of the instance, from instances.json. Used in the bucket name."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account id."
  }
}

variable "region" {
  description = "Region for the state bucket, from instances.json."
  type        = string
}

variable "environment_tag" {
  description = "Value of the environment tag, from instances.json."
  type        = string
}
