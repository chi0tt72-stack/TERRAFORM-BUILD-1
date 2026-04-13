variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
}

variable "allowed_ssh_cidrs" {
  description = "CIDR blocks allowed for SSH"
  type        = list(string)
}

variable "bucket_prefix" {
  description = "S3 bucket name prefix"
  type        = string
}

variable "s3_versioning_enabled" {
  description = "Enable S3 versioning"
  type        = bool
}

variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}

variable "cpu_alarm_threshold" {
  description = "CPU utilization threshold for CloudWatch alarms"
  type        = number
  default     = 80
}

variable "enable_sns_notifications" {
  description = "Enable SNS notifications for CloudWatch alarms"
  type        = bool
  default     = true
}

variable "min_size" {
  description = "Minimum number of instances in the Auto Scaling Group"
  type        = number
  default     = 2
}

variable "desired_capacity" {
  description = "Desired number of instances in the Auto Scaling Group"
  type        = number
  default     = 2
}

variable "max_size" {
  description = "Maximum number of instances in the Auto Scaling Group"
  type        = number
  default     = 4
}

variable "ssh_public_key" {
  description = "SSH public key for EC2 key pair, retrieved from AWS Secrets Manager at runtime"
  type        = string
  sensitive   = true
}

variable "enable_awx" {
  description = "Enable AWX server provisioning"
  type        = bool
  default     = false
}

variable "awx_instance_type" {
  description = "EC2 instance type for AWX server"
  type        = string
  default     = "t3.medium"
}

variable "awx_admin_password_secret_id" {
  description = "Secrets Manager secret ID for AWX admin password"
  type        = string
  default     = "awx/admin-password"
}

variable "ssh_private_key_secret_id" {
  description = "Secrets Manager secret ID for SSH private key used by AWX"
  type        = string
  default     = "terraform/ssh-private-key"
}

variable "awx_project_git_url" {
  description = "Git repository URL for AWX project containing Ansible playbooks"
  type        = string
  default     = ""
}
