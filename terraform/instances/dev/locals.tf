locals {
  instance_name = "dev"

  # instances.json is the only place an account, region, zone or domain is written.
  fleet     = jsondecode(file("${path.module}/../../../instances.json"))
  instances = { for i in local.fleet.instances : i.name => i }
  instance  = local.instances[local.instance_name]

  # Derived name for the Terraform state bucket (ADR-006).
  state_bucket = local.instance.terraform.stateBucket
}
