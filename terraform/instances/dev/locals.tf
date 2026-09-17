locals {
  instance_name = "dev"

  # The fleet record is the only place an account, region, zone or domain is written. The real
  # instances.json is gitignored (per-deployer, holds the AWS account; ADR-004); fall back to the
  # committed instances.example.json placeholder when it is absent (CI's -backend=false validate
  # and mocked-provider tests need no real account).
  fleet_path = fileexists("${path.module}/../../../instances.json") ? "${path.module}/../../../instances.json" : "${path.module}/../../../instances.example.json"
  fleet      = jsondecode(file(local.fleet_path))
  instances  = { for i in local.fleet.instances : i.name => i }
  instance   = local.instances[local.instance_name]

  # Derived name for the Terraform state bucket (ADR-006).
  state_bucket = local.instance.terraform.stateBucket
}
