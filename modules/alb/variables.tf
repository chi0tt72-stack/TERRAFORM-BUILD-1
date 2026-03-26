variable "environment" {
  description = "Environment name (e.g. dev, staging, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where ALB resources will be created"
  type        = string
}

variable "subnet_ids" {
  description = "Public subnet IDs for ALB placement"
  type        = list(string)
}

variable "vpc_cidr" {
  description = "VPC CIDR block for outbound security group rule"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
