# --- AMI Data Source ---
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

# --- AWX Security Group ---
resource "aws_security_group" "awx" {
  name        = "${var.environment}-awx-sg"
  description = "Security group for AWX server"
  vpc_id      = var.vpc_id

  ingress {
    description = "AWX Web UI / API"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  ingress {
    description = "HTTPS access"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description     = "SSH to target instances"
    from_port       = 22
    to_port         = 22
    protocol        = "tcp"
    security_groups = [var.ec2_security_group_id]
  }

  egress {
    description = "Git repos, container registries"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.environment}-awx-sg"
  })
}

# --- IAM Role for AWX EC2 Instance ---
resource "aws_iam_role" "awx" {
  name = "${var.environment}-awx-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name = "${var.environment}-awx-role"
  })
}

# --- IAM Policy for Secrets Manager Access ---
resource "aws_iam_role_policy" "awx_secrets" {
  name = "${var.environment}-awx-secrets-policy"
  role = aws_iam_role.awx.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "secretsmanager:GetSecretValue"
        Resource = [
          "arn:aws:secretsmanager:*:*:secret:${var.awx_admin_password_secret_id}-*",
          "arn:aws:secretsmanager:*:*:secret:${var.ssh_private_key_secret_id}-*"
        ]
      }
    ]
  })
}

# --- IAM Instance Profile ---
resource "aws_iam_instance_profile" "awx" {
  name = "${var.environment}-awx-instance-profile"
  role = aws_iam_role.awx.name

  tags = merge(var.tags, {
    Name = "${var.environment}-awx-instance-profile"
  })
}

# --- AWX EC2 Instance ---
resource "aws_instance" "awx" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.awx.id]
  iam_instance_profile   = aws_iam_instance_profile.awx.name
  key_name               = var.key_pair_name

  user_data = templatefile("${path.module}/templates/user_data.sh.tpl", {
    environment                  = var.environment
    awx_admin_password_secret_id = var.awx_admin_password_secret_id
    ssh_private_key_secret_id    = var.ssh_private_key_secret_id
    awx_project_git_url          = var.awx_project_git_url
  })

  tags = merge(var.tags, {
    Name = "${var.environment}-awx"
  })
}
