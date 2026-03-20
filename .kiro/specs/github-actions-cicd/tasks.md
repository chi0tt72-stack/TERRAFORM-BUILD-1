# Implementation Plan: GitHub Actions CI/CD Pipeline

## Overview

Incrementally build a GitHub Actions CI/CD pipeline that authenticates to AWS via OIDC, manages Terraform state in S3, provisions an Auto Scaling Group via a new `compute-asg` module, and runs Ansible playbooks post-apply. Each task builds on the previous, ending with full integration and test validation.

## Tasks

- [ ] 1. Create IAM policy documents for GitHub Actions OIDC
  - [x] 1.1 Create `iam-policies/github-oidc-trust-policy.json`
    - Model after existing `gitlab-oidc-trust-policy.json`
    - Use `token.actions.githubusercontent.com` as the OIDC provider
    - Include `StringLike` condition on `sub` claim scoped to the GitHub repository
    - Include `StringEquals` condition on `aud` claim set to `sts.amazonaws.com`
    - _Requirements: 1.4, 2.1, 2.2_
  - [x] 1.2 Create `iam-policies/github-terraform-permissions.json`
    - Model after existing `gitlab-terraform-permissions.json`
    - Include actions for: EC2, Auto Scaling, VPC, S3, CloudWatch, SNS, IAM (GetRole, PassRole), Secrets Manager (GetSecretValue, DescribeSecret), KMS (Decrypt, DescribeKey)
    - _Requirements: 2.3, 2.4, 3.6_
  - [x] 1.3 Write property test for IAM trust policy repository scoping
    - **Property 2: IAM trust policy repository scoping**
    - **Validates: Requirements 1.4, 2.2**
  - [x] 1.4 Write property test for IAM permissions policy service completeness
    - **Property 3: IAM permissions policy service completeness**
    - **Validates: Requirements 2.3, 3.6**

- [ ] 2. Set up `environments/dev-github/` directory with S3 backend
  - [ ] 2.1 Create `environments/dev-github/versions.tf`
    - Use `backend "s3" {}` (empty block, config supplied via `-backend-config`)
    - Copy `required_version` and `required_providers` from `environments/dev/versions.tf`
    - _Requirements: 4.1, 4.4_
  - [ ] 2.2 Create `environments/dev-github/github.s3.tfbackend`
    - Set `bucket`, `key = "github/terraform.tfstate"`, `region = "us-east-1"`, `use_lockfile = true`
    - Ensure state key is distinct from any GitLab-managed state
    - _Requirements: 4.1, 4.2, 4.3_
  - [ ] 2.3 Create `environments/dev-github/variables.tf`
    - Define all variables needed by the dev-github environment (mirror `environments/dev/variables.tf` and add ASG-specific variables)
    - _Requirements: 8.3_
  - [ ] 2.4 Create `environments/dev-github/terraform.tfvars`
    - Provide default values mirroring `environments/dev/terraform.tfvars`
    - _Requirements: 4.1_

- [ ] 3. Create `modules/compute-asg/` Terraform module
  - [ ] 3.1 Create `modules/compute-asg/variables.tf`
    - Define inputs: `environment`, `vpc_id`, `subnet_ids`, `instance_type`, `min_size` (default 2), `desired_capacity` (default 2), `max_size` (default 4), `ssh_public_key`, `allowed_ssh_cidrs`, `tags`
    - _Requirements: 8.1, 8.3_
  - [ ] 3.2 Create `modules/compute-asg/main.tf`
    - Create `aws_key_pair` from `ssh_public_key` variable
    - Create `aws_security_group` with SSH + HTTP ingress and all egress
    - Create `aws_launch_template` referencing AMI (via data source or variable), instance type, key pair, and security group
    - Create `aws_autoscaling_group` with `min_size = var.min_size`, `desired_capacity = var.desired_capacity`, `max_size = var.max_size`, and `vpc_zone_identifier = var.subnet_ids` for AZ distribution
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.7_
  - [ ] 3.3 Create `modules/compute-asg/outputs.tf`
    - Output `asg_name`, `launch_template_id`, `instance_ips`, `security_group_id`
    - _Requirements: 8.2, 8.4_
  - [ ]* 3.4 Write property test for ASG capacity constraints
    - **Property 4: ASG capacity constraints**
    - **Validates: Requirements 8.3**
  - [ ]* 3.5 Write property test for launch template required attributes
    - **Property 9: Launch template required attributes**
    - **Validates: Requirements 8.1, 8.7**

- [ ] 4. Wire `environments/dev-github/main.tf` and outputs
  - [ ] 4.1 Create `environments/dev-github/main.tf`
    - Reference existing modules: `modules/networking`, `modules/storage`, `modules/cloudwatch`
    - Reference new `modules/compute-asg` instead of `modules/compute`
    - Pass SSH public key variable to `compute-asg` module
    - _Requirements: 8.1, 8.2_
  - [ ] 4.2 Create `environments/dev-github/outputs.tf`
    - Output ASG name, instance IPs, VPC ID, bucket name
    - _Requirements: 6.3_
  - [ ] 4.3 Create `environments/dev-github/ansible.tf`
    - Use `local_file` resource to generate `ansible/inventory/terraform_hosts.ini` from compute-asg outputs
    - Format: `[dev_instances]` section with `instance_X ansible_host=<IP>` entries, plus `[dev_instances:vars]` with `ansible_user=ec2-user`
    - _Requirements: 8.6, 9.2_
  - [ ]* 4.4 Write property test for inventory generation correctness
    - **Property 5: Inventory generation correctness**
    - **Validates: Requirements 8.6**

- [ ] 5. Checkpoint - Validate Terraform configuration
  - Ensure all Terraform files are syntactically valid (`terraform validate` in `environments/dev-github/`)
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Create GitHub Actions plan workflow
  - [ ] 6.1 Create `.github/workflows/terraform-plan.yml`
    - Trigger on `pull_request` (main) and `push` (main) with path filters for `environments/**`, `modules/**`, `ansible/**`
    - Set job permissions: `id-token: write`, `contents: read`, `pull-requests: write`
    - Add OIDC auth step using `aws-actions/configure-aws-credentials@v4` with `role-to-assume: ${{ vars.AWS_ROLE_ARN }}`
    - Add secrets retrieval step to fetch SSH keys from Secrets Manager
    - Add `terraform init -backend-config=environments/dev-github/github.s3.tfbackend` step
    - Add `terraform validate` and `terraform fmt -check` steps
    - Add `terraform plan -out=plan.tfplan` step and save plan text output
    - Add step to upload plan as artifact (retention 7 days)
    - Add PR comment step using `actions/github-script@v7` to post plan summary (only on `pull_request`)
    - Ensure zero references to `secrets.*` context — use only `vars.*` or hardcoded non-sensitive values
    - _Requirements: 1.1, 1.2, 1.5, 3.3, 3.4, 5.1, 5.2, 5.3, 5.4, 12.1, 12.4, 13.1, 13.2, 13.3, 13.4, 13.5_

- [ ] 7. Create GitHub Actions apply workflow
  - [ ] 7.1 Create `.github/workflows/terraform-apply.yml`
    - Trigger on `push` (main) with path filters for `environments/**`, `modules/**`, `ansible/**`
    - Set job permissions: `id-token: write`, `contents: read`
    - Add OIDC auth step using `aws-actions/configure-aws-credentials@v4`
    - Add secrets retrieval step (SSH private key written to `/tmp/ssh_key` with `chmod 0600`, SSH public key to `$GITHUB_ENV`)
    - Add `terraform init` and `terraform plan` steps
    - Add manual approval gate via `environment: production` on the apply job
    - Add `terraform apply` step
    - Add step to export Terraform outputs (ASG name, instance IPs, VPC ID, bucket name) as workflow outputs
    - Add Ansible integration steps:
      - Generate inventory from Terraform outputs (or use `ansible.tf` output)
      - Run `ansible-playbook ansible/playbooks/site.yml -i ansible/inventory/terraform_hosts.ini -e ansible_ssh_private_key_file=/tmp/ssh_key`
    - Add SSH key cleanup step with `if: always()` to delete `/tmp/ssh_key`
    - If `terraform apply` fails, preserve plan artifact for debugging
    - Ensure zero references to `secrets.*` context
    - _Requirements: 1.1, 1.2, 1.5, 3.1, 3.2, 3.3, 6.1, 6.2, 6.3, 6.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 11.1, 11.2, 11.3, 11.4, 12.2, 12.4, 13.1, 13.5_
  - [ ]* 7.2 Write property test for zero secrets in workflow files
    - **Property 1: Zero secrets in GitHub workflow files**
    - **Validates: Requirements 1.5, 3.4, 13.1, 13.5**
  - [ ]* 7.3 Write property test for SSH key cleanup on all exit paths
    - **Property 7: SSH key cleanup on all exit paths**
    - **Validates: Requirements 11.4**
  - [ ]* 7.4 Write property test for path filters on all workflow triggers
    - **Property 8: Path filters on all workflow triggers**
    - **Validates: Requirements 12.4**

- [ ] 8. Create GitHub Actions destroy workflow
  - [ ] 8.1 Create `.github/workflows/terraform-destroy.yml`
    - Trigger on `workflow_dispatch` only (no path filters needed)
    - Set job permissions: `id-token: write`, `contents: read`
    - Add OIDC auth step using `aws-actions/configure-aws-credentials@v4`
    - Add `terraform init` step
    - Add manual approval gate via `environment: production`
    - Add `terraform destroy -auto-approve` step
    - Add confirmation log message with destroyed environment name on success
    - Ensure zero references to `secrets.*` context
    - _Requirements: 1.1, 1.5, 7.1, 7.2, 7.3, 7.4, 12.3, 13.1, 13.5_

- [ ] 9. Checkpoint - Validate all workflow files and Ansible integration
  - Ensure all YAML workflow files are syntactically valid
  - Ensure all Terraform files pass `terraform validate`
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Set up test infrastructure and write unit tests
  - [ ] 10.1 Initialize test project with TypeScript and fast-check
    - Create `tests/package.json` with dependencies: `vitest`, `fast-check`, `js-yaml`, `hcl2-json` (or equivalent HCL parser)
    - Create `tests/tsconfig.json`
    - Create `tests/vitest.config.ts`
    - _Requirements: All (testing infrastructure)_
  - [ ] 10.2 Create `tests/unit/workflow-structure.test.ts`
    - Parse each workflow YAML file and validate: correct triggers, correct step ordering, `id-token: write` permission, environment references for approval gates, artifact upload in plan workflow, PR comment step in plan workflow
    - _Requirements: 1.1, 1.2, 5.1, 5.2, 5.3, 6.2, 7.2, 12.1, 12.2, 12.3_
  - [ ] 10.3 Create `tests/unit/iam-policy.test.ts`
    - Parse `github-oidc-trust-policy.json` and validate: OIDC provider URL, sub claim condition, aud claim condition
    - Parse `github-terraform-permissions.json` and validate: all required service actions present
    - _Requirements: 1.4, 2.1, 2.2, 2.3_
  - [ ] 10.4 Create `tests/unit/terraform-config.test.ts`
    - Validate `environments/dev-github/versions.tf` has `backend "s3" {}`
    - Validate `github.s3.tfbackend` has distinct key from GitLab state
    - Validate `modules/compute-asg/main.tf` has launch template, ASG, key pair, security group resources
    - _Requirements: 4.1, 4.2, 4.3, 8.1, 8.2_
  - [ ] 10.5 Create `tests/unit/ansible-config.test.ts`
    - Parse `ansible/playbooks/site.yml` and validate: all required packages (httpd, php, php-mysqlnd, php-fpm, php-json, php-xml, python3, pip, mariadb), httpd and php-fpm services enabled and started
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  - [ ]* 10.6 Write property test for required packages in Ansible playbook
    - **Property 6: Required packages in Ansible playbook**
    - **Validates: Requirements 10.1, 10.2, 10.4, 10.5**

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Run full test suite: `cd tests && npm test`
  - Ensure all unit tests and property-based tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Properties 1-9)
- Unit tests validate specific structural correctness of workflow YAML, Terraform HCL, IAM policy JSON, and Ansible playbooks
- All tests use TypeScript with vitest and fast-check as specified in the design document
- The existing GitLab pipeline (`environments/dev/`, `.gitlab-ci.yml`) is not modified by any task
