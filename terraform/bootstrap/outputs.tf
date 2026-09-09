output "state_bucket" {
  description = "Name of the state bucket the instance roots must use in their backend block."
  value       = aws_s3_bucket.state.bucket
}
