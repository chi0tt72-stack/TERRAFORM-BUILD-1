# SNS Topic for CloudWatch Alarms
resource "aws_sns_topic" "cloudwatch_alarms" {
  name = "${var.environment}-cloudwatch-alarms"
}

# CloudWatch Alarms for EC2 CPU
# Use map with static index keys to support unknown instance IDs during replacement
resource "aws_cloudwatch_metric_alarm" "ec2_cpu_high" {
  for_each = { for i, id in var.instance_ids : tostring(i) => id }

  alarm_name          = "${var.environment}-ec2-cpu-high-${each.value}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = var.cpu_alarm_threshold
  alarm_description   = "Triggers when EC2 CPU exceeds ${var.cpu_alarm_threshold}%"
  alarm_actions       = var.enable_sns_notifications ? [aws_sns_topic.cloudwatch_alarms.arn] : []

  dimensions = {
    InstanceId = each.value
  }
}

# CloudWatch Alarms for EC2 Status Check
# Use map with static index keys to support unknown instance IDs during replacement
resource "aws_cloudwatch_metric_alarm" "ec2_status_check" {
  for_each = { for i, id in var.instance_ids : tostring(i) => id }

  alarm_name          = "${var.environment}-ec2-status-check-${each.value}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "Triggers when EC2 status check fails"
  alarm_actions       = var.enable_sns_notifications ? [aws_sns_topic.cloudwatch_alarms.arn] : []

  dimensions = {
    InstanceId = each.value
  }
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.environment}-infrastructure-dashboard"

  dashboard_body = jsonencode({
    widgets = concat(
      # EC2 CPU Utilization
      [for i, instance_id in var.instance_ids : {
        type   = "metric"
        x      = (i % 3) * 8
        y      = 0
        width  = 8
        height = 6
        properties = {
          title  = "EC2 CPU - ${instance_id}"
          region = var.aws_region
          metrics = [
            ["AWS/EC2", "CPUUtilization", "InstanceId", instance_id]
          ]
          view = "timeSeries"
          stat = "Average"
          period = 300
          annotations = {
            horizontal = [{
              value = var.cpu_alarm_threshold
              label = "Alarm Threshold"
              fill  = "above"
            }]
          }
        }
      }],
      # EC2 Network In
      [for i, instance_id in var.instance_ids : {
        type   = "metric"
        x      = (i % 3) * 8
        y      = 6
        width  = 8
        height = 6
        properties = {
          title  = "EC2 Network In - ${instance_id}"
          region = var.aws_region
          metrics = [
            ["AWS/EC2", "NetworkIn", "InstanceId", instance_id]
          ]
          view   = "timeSeries"
          stat   = "Sum"
          period = 300
        }
      }],
      # EC2 Network Out
      [for i, instance_id in var.instance_ids : {
        type   = "metric"
        x      = (i % 3) * 8
        y      = 12
        width  = 8
        height = 6
        properties = {
          title  = "EC2 Network Out - ${instance_id}"
          region = var.aws_region
          metrics = [
            ["AWS/EC2", "NetworkOut", "InstanceId", instance_id]
          ]
          view   = "timeSeries"
          stat   = "Sum"
          period = 300
        }
      }],
      # S3 Bucket metrics (if bucket name provided)
      var.s3_bucket_name != "" ? [
        {
          type   = "metric"
          x      = 0
          y      = 18
          width  = 8
          height = 6
          properties = {
            title  = "S3 Bucket Size - ${var.s3_bucket_name}"
            region = var.aws_region
            metrics = [
              ["AWS/S3", "BucketSizeBytes", "StorageType", "StandardStorage", "BucketName", var.s3_bucket_name]
            ]
            view   = "timeSeries"
            stat   = "Average"
            period = 86400
          }
        },
        {
          type   = "metric"
          x      = 8
          y      = 18
          width  = 8
          height = 6
          properties = {
            title  = "S3 Number of Objects - ${var.s3_bucket_name}"
            region = var.aws_region
            metrics = [
              ["AWS/S3", "NumberOfObjects", "StorageType", "AllStorageTypes", "BucketName", var.s3_bucket_name]
            ]
            view   = "timeSeries"
            stat   = "Average"
            period = 86400
          }
        }
      ] : [],
      # Summary text widget
      [{
        type   = "text"
        x      = 0
        y      = 24
        width  = 24
        height = 3
        properties = {
          markdown = "## ${var.environment} Infrastructure Dashboard\n\nEC2 instances and S3 bucket metrics. Data may take a few minutes to appear after resources are created."
        }
      }]
    )
  })
}
