aws_region            = "us-east-1"
environment           = "terraformtest"
vpc_cidr              = "10.0.0.0/16"
public_subnet_cidrs   = ["10.0.1.0/24", "10.0.2.0/24"]
availability_zones    = ["us-east-1a", "us-east-1b"]
instance_type         = "t3.micro"
allowed_ssh_cidrs     = ["0.0.0.0/0"]
bucket_prefix         = "chiotttfprojecttest"
s3_versioning_enabled = true
min_size              = 2
desired_capacity      = 2
max_size              = 4

tags = {
  Project     = "terraform-course-github"
  Environment = "dev-github"
  ManagedBy   = "terraform"
}
