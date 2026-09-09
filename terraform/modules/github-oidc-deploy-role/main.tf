# The GitHub Actions deploy role (ADR-004 §2, ADR-005 §1).
#
# Assumable only by this repository's main branch through the account's EXISTING
# GitHub OIDC provider (an account singleton; its ARN is constructed, never read or created here).
# Holds what `terraform apply` needs for the federal-mcps stacks, scoped to the
# account's rc-* naming pattern (ADR-006) wherever the service supports it.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0"
    }
  }
}

locals {
  oidc_host = "token.actions.githubusercontent.com"
  # ID-qualified subject: immutable across renames (ADR-004 §2).
  github_subject = "repo:${var.github_owner}@${var.github_owner_id}/${var.github_repo}@${var.github_repo_id}:ref:refs/heads/main"
  # Terraform-managed resources in this account use the rc- prefix (ADR-006 §2).
  name_prefix = "rc-"
}

# The provider ARN is deterministic, so it is constructed rather than read:
# reading it needs iam:ListOpenIDConnectProviders, which rc-deploy is denied (#37).
locals {
  oidc_provider_arn = "arn:aws:iam::${var.account_id}:oidc-provider/${local.oidc_host}"
}

locals {
  # Built with jsonencode rather than aws_iam_policy_document so the policies are
  # plan-time values that `terraform test` can assert on under a mocked provider.
  trust_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "GitHubActionsMainBranch"
      Effect = "Allow"
      Action = "sts:AssumeRoleWithWebIdentity"
      Principal = {
        Federated = local.oidc_provider_arn
      }
      Condition = {
        StringEquals = { "${local.oidc_host}:aud" = "sts.amazonaws.com" }
        StringLike   = { "${local.oidc_host}:sub" = local.github_subject }
      }
    }]
  })
}

resource "aws_iam_role" "deploy" {
  name                 = var.role_name
  description          = "Assumed by GitHub Actions (main branch only) to run terraform apply for federal-mcps"
  assume_role_policy   = local.trust_policy
  max_session_duration = 3600
}

locals {
  deploy_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "StateBucketList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketVersioning"]
        Resource = ["arn:aws:s3:::${var.state_bucket}"]
      },
      {
        Sid      = "StateObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["arn:aws:s3:::${var.state_bucket}/${var.state_key_prefix}*"]
      },
      {
        Sid      = "ManagePrefixedRoles"
        Effect   = "Allow"
        Action   = ["iam:GetRole", "iam:CreateRole", "iam:UpdateRole", "iam:DeleteRole", "iam:TagRole", "iam:UntagRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:PassRole", "iam:UpdateAssumeRolePolicy", "iam:ListInstanceProfilesForRole"]
        Resource = ["arn:aws:iam::${var.account_id}:role/${local.name_prefix}*"]
      },
      {
        Sid      = "ManagePrefixedPolicies"
        Effect   = "Allow"
        Action   = ["iam:GetPolicy", "iam:CreatePolicy", "iam:DeletePolicy", "iam:GetPolicyVersion", "iam:CreatePolicyVersion", "iam:DeletePolicyVersion", "iam:ListPolicyVersions", "iam:TagPolicy", "iam:UntagPolicy"]
        Resource = ["arn:aws:iam::${var.account_id}:policy/${local.name_prefix}*"]
      },
      {
        Sid      = "ManagePrefixedLambdas"
        Effect   = "Allow"
        Action   = ["lambda:GetFunction", "lambda:CreateFunction", "lambda:DeleteFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:GetFunctionConfiguration", "lambda:GetFunctionCodeSigningConfig", "lambda:AddPermission", "lambda:RemovePermission", "lambda:GetPolicy", "lambda:TagResource", "lambda:UntagResource", "lambda:ListVersionsByFunction", "lambda:PublishVersion", "lambda:ListTags"]
        Resource = ["arn:aws:lambda:${var.region}:${var.account_id}:function:${local.name_prefix}*"]
      },
      {
        Sid      = "ManageLogGroups"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:DescribeLogGroups", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy", "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource", "logs:TagLogGroup"]
        Resource = ["arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${local.name_prefix}*", "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/apigateway/${local.name_prefix}*", "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${local.name_prefix}*:*", "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/apigateway/${local.name_prefix}*:*"]
      },
      {
        Sid      = "ManageHttpApis"
        Effect   = "Allow"
        Action   = ["apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE"]
        Resource = ["arn:aws:apigateway:${var.region}::/*"]
      },
      {
        Sid      = "ManageCertificates"
        Effect   = "Allow"
        Action   = ["acm:RequestCertificate", "acm:DescribeCertificate", "acm:DeleteCertificate", "acm:ListTagsForCertificate", "acm:AddTagsToCertificate", "acm:RemoveTagsFromCertificate", "acm:ListCertificates"]
        Resource = ["*"]
      },
      {
        Sid      = "ManageZoneRecords"
        Effect   = "Allow"
        Action   = ["route53:GetHostedZone", "route53:ListResourceRecordSets", "route53:ChangeResourceRecordSets", "route53:ListTagsForResource"]
        Resource = ["arn:aws:route53:::hostedzone/${var.hosted_zone_id}"]
      },
      {
        Sid      = "ReadRoute53Changes"
        Effect   = "Allow"
        Action   = ["route53:GetChange", "route53:ListHostedZones"]
        Resource = ["*"]
      },
      {
        Sid      = "PostDeployVerification"
        Effect   = "Allow"
        Action   = ["lambda:GetFunctionConfiguration"]
        Resource = ["arn:aws:lambda:${var.region}:${var.account_id}:function:${local.name_prefix}*"]
      },
    ]
  })
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${var.role_name}-apply"
  role   = aws_iam_role.deploy.id
  policy = local.deploy_policy
}
