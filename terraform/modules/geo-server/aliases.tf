# --- Alias hostnames (ADR-016 §2) ---------------------------------------------
#
# Additional hostnames for the same API: one ACM certificate, apigatewayv2 domain
# name, API mapping and A/AAAA alias records per entry, additive to var.domain_name
# (which is never touched, so the live domain is not recreated). Used to serve the
# short `<service>.responsive.city` names alongside the original `*-mcp` names.

resource "aws_acm_certificate" "alias" {
  for_each = toset(var.alias_domain_names)

  domain_name       = each.value
  validation_method = "DNS"

  tags = {
    project     = "federal-mcps"
    environment = var.environment_tag
  }

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  alias_validation_records = merge([
    for alias in var.alias_domain_names : {
      for dvo in aws_acm_certificate.alias[alias].domain_validation_options :
      "${alias}/${dvo.domain_name}" => {
        alias  = alias
        name   = dvo.resource_record_name
        type   = dvo.resource_record_type
        record = dvo.resource_record_value
      }
    }
  ]...)
}

resource "aws_route53_record" "alias_cert_validation" {
  for_each = local.alias_validation_records

  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "alias" {
  for_each = toset(var.alias_domain_names)

  certificate_arn = aws_acm_certificate.alias[each.value].arn
  validation_record_fqdns = [
    for key, r in aws_route53_record.alias_cert_validation : r.fqdn if local.alias_validation_records[key].alias == each.value
  ]
}

resource "aws_apigatewayv2_domain_name" "alias" {
  for_each = toset(var.alias_domain_names)

  domain_name = each.value

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.alias[each.value].certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "alias" {
  for_each = toset(var.alias_domain_names)

  api_id      = aws_apigatewayv2_api.geo.id
  domain_name = aws_apigatewayv2_domain_name.alias[each.value].id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "alias_alias_a" {
  for_each = toset(var.alias_domain_names)

  zone_id = var.hosted_zone_id
  name    = each.value
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.alias[each.value].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.alias[each.value].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_alias_aaaa" {
  for_each = toset(var.alias_domain_names)

  zone_id = var.hosted_zone_id
  name    = each.value
  type    = "AAAA"

  alias {
    name                   = aws_apigatewayv2_domain_name.alias[each.value].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.alias[each.value].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
