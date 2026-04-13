variable "environment" {
  description = "Environment name (e.g. dev, staging, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where AWX resources will be created"
  type        = string
}

variable "subnet_id" {
  description = "Subnet ID for AWX EC2 instance placement"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block for security group inbound rules"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for AWX server"
  type        = string
  default     = "t3.medium"
}

variable "ec2_security_group_id" {
  description = "Security group ID of the compute EC2 instances (for SSH egress rule)"
  type        = string
}

variable "awx_admin_password_secret_id" {
  description = "Secrets Manager secret ID for AWX admin password"
  type        = string
}

variable "ssh_private_key_secret_id" {
  description = "Secrets Manager secret ID for SSH private key"
  type        = string
}

variable "awx_project_git_url" {
  description = "Git repository URL for the AWX project containing Ansible playbooks"
  type        = string
}

variable "key_pair_name" {
  description = "Existing EC2 key pair name for SSH access to AWX instance"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
