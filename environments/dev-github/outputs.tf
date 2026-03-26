output "asg_name" {
  description = "Name of the Auto Scaling Group"
  value       = module.compute_asg.asg_name
}

output "instance_ips" {
  description = "Public IPs of ASG instances"
  value       = module.compute_asg.instance_ips
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.networking.vpc_id
}

output "s3_bucket_name" {
  description = "S3 bucket name"
  value       = module.storage.bucket_id
}

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = module.alb.alb_dns_name
}
