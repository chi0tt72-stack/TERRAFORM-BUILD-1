# Implementation Plan: AWX Integration

## Overview

Replace direct Ansible execution in the GitHub Actions pipeline with an AWX server managed by Terraform. Create a new `modules/awx/` Terraform module, wire it into the environment configuration, modify the `terraform-apply.yml` workflow to use AWX API calls, and add property-based and unit tests.

## Tasks

- [x] 1. Create AWX Terraform module core infrastructure
  - [x] 1.1 Create `modules/awx/variables.tf` with all input variables
    - Define: `environment`, `vpc_id`, `subnet_id`, `vpc_cidr`, `instance_type` (default `t3.medium`), `ec2_security_group_id`, `awx_admin_password_secret_id`, `ssh_private_key_secret_id`, `awx_project_git_url`, `key_pair_name`, `tags`
    - _Requirements: 1.7, 13.2, 13.3_

  - [x] 1.2 Create `modules/awx/main.tf` with EC2 instance, security group, and IAM resources
    - Create `aws_security_group.awx` with:
      - Ingress TCP 80 from `var.vpc_cidr` (AWX Web UI / API)
      - Ingress TCP 443 from `var.vpc_cidr` (HTTPS)
      - Egress TCP 22 to `var.ec2_security_group_id` (SSH to target instances)
      - Egress TCP 443 to `0.0.0.0/0` (Git repos, container registries)
    - Create `aws_iam_role.awx` with EC2 assume role policy
    - Create `aws_iam_role_policy.awx_secrets` allowing `secretsmanager:GetSecretValue` for the SSH key and AWX admin password secrets
    - Create `aws_iam_instance_profile.awx` referencing the IAM role
    - Create `aws_instance.awx` with:
      - `instance_type = var.instance_type`
      - `subnet_id = var.subnet_id`
      - `vpc_security_group_ids` referencing the AWX security group
      - `iam_instance_profile` referencing the instance profile
      - `key_name = var.key_pair_name`
      - `user_data` from `templatefile("${path.module}/templates/user_data.sh.tpl", ...)`
    - _Requirements: 1.1, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 4.2_

  - [x] 1.3 Create `modules/awx/outputs.tf`
    - Output `awx_private_ip` (private IP of the AWX EC2 instance)
    - Output `awx_instance_id` (instance ID)
    - Output `awx_security_group_id` (security group ID)
    - _Requirements: 1.6_


  - [x] 1.4 Write property test for AWX security group ingress rules
    - **Property 1: AWX security group ingress rules only allow VPC CIDR**
    - Create `tests/property/awx-sg-ingress.property.test.ts`
    - Parse `modules/awx/main.tf` and verify all ingress rules reference VPC CIDR variable, never `0.0.0.0/0`, and only allow ports 80 and 443
    - **Validates: Requirements 2.2, 2.3, 2.6**

- [x] 2. Create AWX bootstrap user_data template
  - [x] 2.1 Create `modules/awx/templates/user_data.sh.tpl`
    - Install Docker and Docker Compose
    - Pull and start AWX containers via Docker Compose
    - Wait for AWX API to become available locally
    - Retrieve SSH private key from Secrets Manager using instance IAM role
    - Configure AWX resources via AWX CLI or REST API:
      - Organization (Default)
      - SCM Credential (if private repo)
      - Project pointing to `awx_project_git_url` with `scm_update_on_launch: true`
      - Machine Credential with SSH private key and `ec2-user` username
      - Inventory `dev-inventory` with host group `dev_instances`
      - Job Template `site-yml` referencing project, inventory, credential, playbook `ansible/playbooks/site.yml` with `become_enabled: true` and `ask_variables_on_launch: true`
    - Sync the project to pull playbooks from Git
    - _Requirements: 1.3, 1.4, 4.2, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x]* 2.2 Write unit tests for AWX bootstrap script content
    - Create `tests/unit/awx-bootstrap.test.ts`
    - Verify user_data template contains Docker Compose setup
    - Verify bootstrap configures: project, credential (ec2-user), inventory (dev_instances), job template (site-yml, become enabled)
    - _Requirements: 1.3, 5.1, 5.2, 6.1, 6.2, 6.3, 7.1, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 3. Checkpoint - Validate AWX module Terraform configuration
  - Ensure all Terraform files in `modules/awx/` are syntactically valid
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Wire AWX module into environment configuration
  - [x] 4.1 Add AWX-related variables to `environments/dev-github/variables.tf`
    - Add `enable_awx` (bool, default `false`)
    - Add `awx_instance_type` (string, default `t3.medium`)
    - Add `awx_admin_password_secret_id` (string, default `awx/admin-password`)
    - Add `ssh_private_key_secret_id` (string, default `terraform/ssh-private-key`)
    - Add `awx_project_git_url` (string, default `""`)
    - _Requirements: 13.5_

  - [x] 4.2 Add AWX module block to `environments/dev-github/main.tf`
    - Add `module "awx"` with `count = var.enable_awx ? 1 : 0`
    - Wire `vpc_id` from `module.networking.vpc_id`
    - Wire `subnet_id` from `module.networking.public_subnet_ids[0]`
    - Wire `vpc_cidr` from `var.vpc_cidr`
    - Wire `ec2_security_group_id` from `module.compute_asg.security_group_id`
    - Pass AWX-specific variables
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 4.3 Add SSH ingress rule from AWX to compute ASG security group
    - Add `aws_security_group_rule.asg_ssh_from_awx` in `environments/dev-github/main.tf`
    - `count = var.enable_awx ? 1 : 0`
    - Ingress TCP 22 on `module.compute_asg.security_group_id` from `module.awx[0].awx_security_group_id`
    - _Requirements: 3.2, 3.4_

  - [x] 4.4 Add AWX outputs to `environments/dev-github/outputs.tf`
    - Add `awx_private_ip` output (conditional on `var.enable_awx`)
    - _Requirements: 13.4, 14.3_

  - [x] 4.5 Add AWX tfvars defaults to `environments/dev-github/terraform.tfvars`
    - Add `enable_awx = true` and `awx_project_git_url` with the repository URL
    - _Requirements: 13.1_

  - [x]* 4.6 Write unit tests for AWX environment configuration
    - Create or update `tests/unit/awx-module-structure.test.ts`
    - Verify `modules/awx/` contains `main.tf`, `variables.tf`, `outputs.tf`, `templates/user_data.sh.tpl`
    - Verify `environments/dev-github/main.tf` includes AWX module with conditional count
    - Verify `environments/dev-github/outputs.tf` includes `awx_private_ip`
    - Verify `environments/dev-github/variables.tf` includes `enable_awx` variable
    - _Requirements: 1.2, 1.6, 1.7, 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 5. Checkpoint - Validate environment configuration with AWX module
  - Ensure all Terraform files in `environments/dev-github/` are syntactically valid
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Modify GitHub Actions apply workflow for AWX integration
  - [x] 6.1 Remove direct Ansible execution steps from `terraform-apply.yml` apply job
    - Remove the "Generate Ansible inventory from ASG" step
    - Remove the "Run Ansible Playbook" step
    - Remove SSH private key retrieval from the apply job (retain SSH public key retrieval for Terraform key pair)
    - Retain the "Wait for ASG instances to be ready" step
    - Retain SSH key cleanup step
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 6.2 Add AWX admin password retrieval step to apply job
    - After "Export Terraform Outputs", add step to retrieve AWX admin password from Secrets Manager
    - Use `vars.AWX_ADMIN_PASSWORD_SECRET` or hardcoded `awx/admin-password` as secret ID
    - On failure, terminate with non-zero exit code and descriptive error
    - _Requirements: 4.1, 4.3, 4.4, 14.1, 14.4_

  - [x] 6.3 Add AWX health check step to apply job
    - Poll `GET http://{awx_private_ip}/api/v2/ping/` every 10 seconds
    - Timeout after 300 seconds with descriptive error message
    - Use AWX private IP from Terraform outputs
    - Use `set -euo pipefail` and explicit HTTP code checking
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 6.4 Add AWX inventory update step to apply job
    - Send current ASG instance private IPs to AWX via API
    - Update the `dev_instances` host group in the `dev-inventory` inventory
    - Authenticate using AWX admin password
    - On failure, log error and exit 1
    - _Requirements: 7.2, 7.3, 7.4, 9.3_

  - [x] 6.5 Add AWX job launch step to apply job
    - `POST /api/v2/job_templates/site-yml/launch/` with extra variables
    - Authenticate using AWX admin password
    - Use AWX private IP (not public endpoint)
    - On API error, log response body and exit 1
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 14.2_

  - [x] 6.6 Add AWX job polling step to apply job
    - Poll `GET /api/v2/jobs/{id}/` every 15 seconds
    - Continue polling while status is "pending" or "running", log status updates
    - On "successful": log completion and continue
    - On "failed" or "error": retrieve job stdout, log it, exit 1
    - Timeout after 600 seconds with error message
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 6.7 Add `awx_private_ip` to Terraform outputs export step
    - Add `awx_private_ip` to the "Export Terraform Outputs" step (conditional on AWX being enabled)
    - _Requirements: 14.3_

  - [x]* 6.8 Write property test: pipeline does not handle SSH private keys for Ansible
    - **Property 2: Pipeline does not handle SSH private keys for Ansible execution**
    - Create `tests/property/awx-no-ssh-keys.property.test.ts`
    - Verify the apply job does not contain `ssh-private-key` retrieval for Ansible execution
    - **Validates: Requirements 6.5, 12.3**

  - [x]* 6.9 Write property test: zero AWX secrets in GitHub workflow files
    - **Property 5: Zero AWX secrets in GitHub workflow files**
    - Create `tests/property/awx-zero-secrets.property.test.ts`
    - Verify no `secrets.*` references for AWX-related config in workflow files
    - All AWX values sourced from `vars.*`, Terraform outputs, or hardcoded non-sensitive identifiers
    - **Validates: Requirements 14.1, 14.2, 14.4**

  - [x]* 6.10 Write unit tests for AWX workflow changes
    - Create or update `tests/unit/awx-workflow.test.ts`
    - Verify "Generate Ansible inventory from ASG" step is removed
    - Verify "Run Ansible Playbook" step is removed
    - Verify health check step exists before job launch
    - Verify SSH public key retrieval is retained
    - Verify AWX steps are in correct order: health check → inventory update → job launch → poll
    - _Requirements: 11.1, 12.1, 12.2, 12.4_

- [x] 7. Checkpoint - Validate workflow changes
  - Ensure `terraform-apply.yml` is syntactically valid YAML
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Write property tests for AWX job polling and health check logic
  - [x]* 8.1 Write property test for AWX job polling state machine
    - **Property 3: AWX job polling state machine correctness**
    - Create `tests/property/awx-job-polling.property.test.ts`
    - Generate arbitrary sequences of AWX job status responses ("pending", "running", "successful", "failed", "error")
    - Verify: continues polling on "pending"/"running", returns success on "successful", returns failure on "failed"/"error", returns timeout after 600 seconds
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**

  - [x]* 8.2 Write property test for AWX health check retry logic
    - **Property 4: AWX health check retry logic correctness**
    - Create `tests/property/awx-health-check.property.test.ts`
    - Generate arbitrary sequences of health check responses (success/failure)
    - Verify: retries every 10 seconds on failure, returns success on first successful response, returns timeout after 300 seconds
    - **Validates: Requirements 11.2, 11.3**

- [x] 9. Update IAM permissions for AWX resources
  - [x] 9.1 Update `iam-policies/github-terraform-permissions.json`
    - Ensure IAM permissions include `iam:CreateRole`, `iam:PutRolePolicy`, `iam:CreateInstanceProfile`, `iam:AddRoleToInstanceProfile`, `iam:DeleteRole`, `iam:DeleteRolePolicy`, `iam:RemoveRoleFromInstanceProfile`, `iam:DeleteInstanceProfile`, `iam:GetInstanceProfile` if not already present
    - These are needed for the AWX IAM role and instance profile creation
    - _Requirements: 1.1, 4.2_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Run full test suite: `cd tests && npx vitest --run`
  - Ensure all unit tests and property-based tests pass
  - Ensure all Terraform files validate successfully
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Properties 1-5)
- Unit tests validate specific structural correctness of Terraform HCL, user_data template, and workflow YAML
- All tests use TypeScript with vitest and fast-check, matching the existing test infrastructure in `tests/`
- The `enable_awx` variable allows the AWX module to be conditionally provisioned
- The existing Ansible playbooks (`ansible/playbooks/site.yml`) are reused without modification inside AWX
