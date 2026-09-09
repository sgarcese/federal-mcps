locals {
  instance_name = "dev"

  # instances.json is the only place an account, region, zone or domain is written.
  fleet     = jsondecode(file("${path.module}/../../../instances.json"))
  instances = { for i in local.fleet.instances : i.name => i }
  instance  = local.instances[local.instance_name]

  # Derived names that other modules and the runbook rely on.
  state_bucket     = "federal-mcps-tfstate-${local.instance.account}"
  deploy_role_name = element(split("/", local.instance.deployRoleArn), 1)
}
