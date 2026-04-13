output "awx_private_ip" {
  description = "Private IP of the AWX EC2 instance"
  value       = aws_instance.awx.private_ip
}

output "awx_instance_id" {
  description = "Instance ID of the AWX EC2 instance"
  value       = aws_instance.awx.id
}

output "awx_security_group_id" {
  description = "Security group ID of the AWX instance"
  value       = aws_security_group.awx.id
}
