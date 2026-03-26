provider "aws" {
  region = var.aws_region
}

resource "random_id" "suffix" {
  byte_length = 4
}

module "networking" {
  source = "../../modules/networking"

  environment         = var.environment
  vpc_cidr            = var.vpc_cidr
  public_subnet_cidrs = var.public_subnet_cidrs
  availability_zones  = var.availability_zones
  tags                = var.tags
}

module "alb" {
  source = "../../modules/alb"

  environment = var.environment
  vpc_id      = module.networking.vpc_id
  subnet_ids  = module.networking.public_subnet_ids
  vpc_cidr    = var.vpc_cidr
  tags        = var.tags
}

module "compute_asg" {
  source = "../../modules/compute-asg"

  environment           = var.environment
  vpc_id                = module.networking.vpc_id
  subnet_ids            = module.networking.public_subnet_ids
  instance_type         = var.instance_type
  min_size              = var.min_size
  desired_capacity      = var.desired_capacity
  max_size              = var.max_size
  ssh_public_key        = var.ssh_public_key
  allowed_ssh_cidrs     = var.allowed_ssh_cidrs
  alb_security_group_id = module.alb.alb_security_group_id
  target_group_arns     = [module.alb.target_group_arn]
  tags                  = var.tags
}

module "storage" {
  source = "../../modules/storage"

  environment        = var.environment
  bucket_prefix      = var.bucket_prefix
  random_suffix      = random_id.suffix.hex
  versioning_enabled = var.s3_versioning_enabled
  tags               = var.tags
}

module "cloudwatch" {
  source = "../../modules/cloudwatch"

  environment              = var.environment
  aws_region               = var.aws_region
  instance_ids             = []
  s3_bucket_name           = module.storage.bucket_id
  cpu_alarm_threshold      = var.cpu_alarm_threshold
  enable_sns_notifications = var.enable_sns_notifications
}
