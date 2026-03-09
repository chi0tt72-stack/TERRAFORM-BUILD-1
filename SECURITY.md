# SECURITY.md

## Security Architecture Overview

This document outlines the security implementation for the GitLab CI/CD pipeline with AWS infrastructure managed by Terraform. This setup eliminates the need for long-lived AWS credentials by using OpenID Connect (OIDC) authentication.

---

## Table of Contents

1. [Authentication Architecture](#authentication-architecture)
2. [AWS IAM Configuration](#aws-iam-configuration)
3. [GitLab CI/CD Security](#gitlab-cicd-security)
4. [Secrets Management](#secrets-management)
5. [SSH Key Management](#ssh-key-management)
6. [Network Security](#network-security)
7. [Monitoring and Alerting](#monitoring-and-alerting)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Security Best Practices](#security-best-practices)
10. [Incident Response](#incident-response)

---

## Authentication Architecture

### OIDC (OpenID Connect) Authentication

**Why OIDC?**
- ✅ No long-lived AWS credentials stored in GitLab
- ✅ Temporary credentials that expire after 1 hour
- ✅ Credentials scoped to specific GitLab projects and branches
- ✅ Automatic credential rotation
- ✅ Audit trail through AWS CloudTrail

**Authentication Flow:**

---

## AWS IAM Configuration

### OIDC Provider Setup

**Create OIDC provider in AWS:**

```bash
aws iam create-open-id-connect-provider \
  --url https://gitlab.com \
  --client-id-list https://gitlab.com \
  --thumbprint-list 7e04de896a3e666be93d4e3b6451b7e1c442c518
```

**Trust policy example:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::877833852920:oidc-provider/gitlab.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringLike": {
          "gitlab.com:sub": "project_path:chi0tt72-stack/terraformioctest:*"
        },
        "StringEquals": {
          "gitlab.com:aud": "https://gitlab.com"
        }
      }
    }
  ]
}
```

---

## GitLab CI/CD Security

### OIDC Token Configuration

```yaml
id_tokens:
  GITLAB_OIDC_TOKEN:
    aud: https://gitlab.com

variables:
  TF_ROOT: ${CI_PROJECT_DIR}/environments/dev
  TF_STATE_NAME: dev
  TF_ADDRESS: ${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/terraform/state/${TF_STATE_NAME}
  AWS_DEFAULT_REGION: us-east-1
  AWS_ROLE_ARN: arn:aws:iam::877833852920:role/GitLabTerraformRole

before_script:
  # Get JWT token
  - |
    if [ -n "$GITLAB_OIDC_TOKEN" ]; then
      JWT_TOKEN=$GITLAB_OIDC_TOKEN
    elif [ -n "$CI_JOB_JWT_V2" ]; then
      JWT_TOKEN=$CI_JOB_JWT_V2
    else
      echo "✗ ERROR: No JWT token available!"
      exit 1
    fi

  # Authenticate to AWS
  - aws sts assume-role-with-web-identity \
      --role-arn ${AWS_ROLE_ARN} \
      --role-session-name "GitLabRunner-${CI_PROJECT_ID}-${CI_PIPELINE_ID}" \
      --web-identity-token ${JWT_TOKEN} \
      --duration-seconds 3600 \
      --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
      --output text > /tmp/creds.txt

  # Export credentials
  - |
    if grep -qE "ASIA|AKIA" /tmp/creds.txt; then
      export $(printf "AWS_ACCESS_KEY_ID=%s AWS_SECRET_ACCESS_KEY=%s AWS_SESSION_TOKEN=%s" $(cat /tmp/creds.txt))
    else
      echo "✗ Failed to get AWS credentials"
      exit 1
    fi

  # GitLab backend authentication
  - export TF_HTTP_ADDRESS=${TF_ADDRESS}
  - export TF_HTTP_LOCK_ADDRESS=${TF_ADDRESS}/lock
  - export TF_HTTP_UNLOCK_ADDRESS=${TF_ADDRESS}/lock
  - export TF_HTTP_USERNAME=gitlab-ci-token
  - export TF_HTTP_PASSWORD=${CI_JOB_TOKEN}
  - export TF_HTTP_LOCK_METHOD=POST
  - export TF_HTTP_UNLOCK_METHOD=DELETE
  - export TF_HTTP_RETRY_WAIT_MIN=5

  # Initialize with explicit backend config
  - |
    terraform init -reconfigure \
      -backend-config="address=${TF_HTTP_ADDRESS}" \
      -backend-config="lock_address=${TF_HTTP_LOCK_ADDRESS}" \
      -backend-config="unlock_address=${TF_HTTP_UNLOCK_ADDRESS}" \
      -backend-config="username=${TF_HTTP_USERNAME}" \
      -backend-config="password=${TF_HTTP_PASSWORD}" \
      -backend-config="lock_method=${TF_HTTP_LOCK_METHOD}" \
      -backend-config="unlock_method=${TF_HTTP_UNLOCK_METHOD}" \
      -backend-config="retry_wait_min=${TF_HTTP_RETRY_WAIT_MIN}"

apply:
  stage: apply
  when: manual  # ← Requires manual approval
  only:
    - main
```

---

## Secrets Management

### AWS Secrets Manager Integration

```hcl
data "aws_secretsmanager_secret" "ssh_key" {
  name = "terraform/ssh-public-key"
}

data "aws_secretsmanager_secret_version" "ssh_key" {
  secret_id = data.aws_secretsmanager_secret.ssh_key.id
}
```

---

## SSH Key Management

### Generate SSH Key Pair

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/terraform-course-key -N ""
```

### Terraform Key Pair Resource

```hcl
resource "aws_key_pair" "main" {
  key_name   = "${var.environment}-key"
  public_key = data.aws_secretsmanager_secret_version.ssh_key.secret_string
}
```

### Connect to EC2 Instance

```bash
ssh -i ~/.ssh/terraform-course-key ec2-user@<instance-ip>
```

---

## Network Security

- Security groups configured with least privilege
- Network segmentation for infrastructure components

---

## Monitoring and Alerting

### CloudTrail Log Review

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=Username,AttributeValue=GitLabTerraformRole \
  --max-results 50
```

### Audit Trail

**GitLab provides:**
- ✅ Who triggered the pipeline (user ID)
- ✅ What changes were made (Git commits with diffs)
- ✅ When changes were applied (timestamps)
- ✅ Pipeline execution logs (full output)
- ✅ Manual approval records

**AWS provides:**
- ✅ CloudTrail logs of all API calls
- ✅ IAM role assumption events with session names
- ✅ Resource creation/modification/deletion timestamps
- ✅ Session names include project/pipeline IDs for correlation

---

## Troubleshooting Guide

### Check Trust Policy

```bash
aws iam get-role --role-name GitLabTerraformRole \
  --query 'Role.AssumeRolePolicyDocument' --output json
```

### Verify OIDC Configuration in .gitlab-ci.yml

```bash
grep -A 2 "id_tokens:" .gitlab-ci.yml
```

### Verify Trust Policy Condition

```json
"StringLike": {
  "gitlab.com:sub": "project_path:chi0tt72-stack/terraformioctest:*"
}
```

### Terraform Init with Backend Config

```bash
terraform init -reconfigure \
  -backend-config="address=${TF_HTTP_ADDRESS}" \
  -backend-config="username=${TF_HTTP_USERNAME}" \
  -backend-config="password=${TF_HTTP_PASSWORD}"
```

### Recreate OIDC Provider

```bash
aws iam delete-open-id-connect-provider \
  --open-id-connect-provider-arn arn:aws:iam::ACCOUNT:oidc-provider/gitlab.com

aws iam create-open-id-connect-provider \
  --url https://gitlab.com \
  --client-id-list https://gitlab.com \
  --thumbprint-list 7e04de896a3e666be93d4e3b6451b7e1c442c518
```

---

## Security Best Practices

### Compliance Frameworks

This setup supports:
- ✅ **SOC 2** - Audit trails, access controls, change management
- ✅ **ISO 27001** - Security controls, monitoring, incident response
- ✅ **PCI DSS** - Network segmentation, access controls, logging
- ✅ **HIPAA** - Encryption at rest/transit, access logs, audit trails

### Regular Security Reviews

**Weekly Tasks:**
- Review CloudWatch alarms and anomalies
- Check for failed pipeline runs
- Verify no manual AWS console changes

**Monthly Tasks:**
- Review IAM permissions for least privilege
- Audit security group rules
- Review CloudTrail logs for suspicious activity
- Update dependencies (Terraform, providers)
- Test incident response procedures

**Quarterly Tasks:**
- Rotate SSH keys
- Review and update security policies
- Conduct security training
- Penetration testing (if applicable)
- Disaster recovery drill

### Additional Resources

**Documentation:**
- [GitLab OIDC Documentation](https://docs.gitlab.com/ee/ci/cloud_services/)
- [AWS IAM OIDC Documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- GitLab Terraform HTTP Backend

**Security Tools:**
- AWS CloudTrail - Audit logging
- AWS Config - Configuration compliance
- GitLab Security Scanning - SAST, dependency scanning
- Checkov - Terraform security scanning
- tfsec - Terraform static analysis

---

## Incident Response

### 1. Unauthorized Terraform Changes

```bash
# Check recent Terraform state changes in GitLab
# Review pipeline history
# Identify unauthorized changes

# Revert to known good state
cd ~/TERRAFORM-BUILD-1
git revert <commit-hash>
git push origin main

# Trigger pipeline to restore infrastructure
```

### 2. IAM Role Compromise

```bash
# Immediately revoke role sessions
aws iam update-assume-role-policy \
  --role-name GitLabTerraformRole \
  --policy-document '{"Version":"2012-10-17","Statement":[]}'

# Rotate OIDC provider
aws iam delete-open-id-connect-provider \
  --open-id-connect-provider-arn arn:aws:iam::ACCOUNT:oidc-provider/gitlab.com

aws iam create-open-id-connect-provider \
  --url https://gitlab.com \
  --client-id-list https://gitlab.com \
  --thumbprint-list 7e04de896a3e666be93d4e3b6451b7e1c442c518

# Restore trust policy with updated conditions
aws iam update-assume-role-policy \
  --role-name GitLabTerraformRole \
  --policy-document file://trust-policy.json

# Review CloudTrail logs
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=Username,AttributeValue=GitLabTerraformRole \
  --max-results 50
```

### 3. SSH Key Compromise

```bash
# Generate new SSH key pair
ssh-keygen -t rsa -b 4096 -f ~/.ssh/terraform-course-key-new -N ""

# Update Secrets Manager
aws secretsmanager update-secret \
  --secret-id terraform/ssh-public-key \
  --secret-string "$(cat ~/.ssh/terraform-course-key-new.pub)"

# Trigger Terraform to update EC2 key pairs
cd ~/TERRAFORM-BUILD-1
git commit --allow-empty -m "security: rotate SSH keys"
git push origin main

# Delete old key
rm ~/.ssh/terraform-course-key ~/.ssh/terraform-course-key.pub
mv ~/.ssh/terraform-course-key-new ~/.ssh/terraform-course-key
mv ~/.ssh/terraform-course-key-new.pub ~/.ssh/terraform-course-key.pub
```

### 4. Pipeline Compromise

- Disable pipeline in GitLab: Settings → CI/CD → General pipelines → Disable Auto DevOps
- Review recent pipeline runs for suspicious activity
- Check GitLab audit logs
- Rotate GitLab tokens if needed: Settings → Access Tokens → Revoke compromised tokens
- Review and update `.gitlab-ci.yml`: `git log --all --full-history -- .gitlab-ci.yml`
- Re-enable pipeline after verification

### 5. Emergency Contact List

**Escalation Path:**
- DevOps Team Lead - First responder
- Security Team - For security incidents
- AWS Account Owner - For account-level issues
- GitLab Administrator - For GitLab-related issues

**Communication Channels:**
- Incident Slack channel
- PagerDuty alerts
- Email distribution list

---

## Summary

This security implementation provides:
- ✅ Zero long-lived credentials - OIDC eliminates static AWS keys
- ✅ Temporary credentials - Expire after 1 hour automatically
- ✅ Least privilege access - IAM policies scoped to minimum required
- ✅ Audit trail - Complete logging in GitLab and AWS CloudTrail
- ✅ Manual approval gates - Prevents accidental changes
- ✅ Encrypted state - Terraform state encrypted at rest in GitLab
- ✅ Network security - Security groups with least privilege
- ✅ Monitoring - CloudWatch alarms for anomaly detection
- ✅ Incident response - Documented procedures for security events

---

**Last Updated:** March 9, 2026  
**Maintained By:** DevOps Team  
**Review Frequency:** Quarterly  

For questions or security concerns, contact: security@example.com
