# Requirements Document

## Introduction

This feature replaces the direct Ansible execution in the existing GitHub Actions CI/CD pipeline with AWX (open-source Ansible Tower) API calls. An AWX server will be provisioned and managed by Terraform as part of the infrastructure. AWX will own the Ansible execution lifecycle: managing SSH credentials, dynamic inventories, and job templates. The GitHub Actions apply workflow will trigger AWX jobs via the AWX REST API and poll for completion, instead of running ansible-playbook directly on the GitHub Actions runner. The existing Ansible playbooks (site.yml) will be reused within AWX without modification. This integration lays the groundwork for future blue/green deployment capabilities.

## Glossary

- **AWX_Server**: An EC2 instance running AWX (open-source Ansible Tower) provisioned and managed by Terraform, responsible for executing Ansible playbooks against target EC2 instances
- **AWX_API**: The AWX REST API (v2) used by the Pipeline to trigger job launches, check job status, and retrieve job output
- **AWX_Module**: A Terraform module (modules/awx/) that provisions the AWX_Server EC2 instance, its security group, and related resources
- **Job_Template**: An AWX resource that defines a reusable Ansible job configuration, including the playbook path, inventory, credentials, and extra variables
- **AWX_Inventory**: An AWX inventory resource that defines the target hosts for Ansible execution, sourced dynamically from the Auto_Scaling_Group
- **AWX_Credential**: An AWX credential resource that stores the SSH private key used to connect to target EC2 instances
- **AWX_Project**: An AWX project resource that references the Git repository containing the Ansible playbooks
- **Pipeline**: The GitHub Actions workflow (terraform-apply.yml) that orchestrates Terraform apply and AWX job execution
- **Terraform_Runner**: The component of the Pipeline responsible for executing Terraform commands
- **Auto_Scaling_Group**: The existing AWS Auto Scaling Group that manages the target EC2 instances
- **Secrets_Manager**: AWS Secrets Manager, the store for sensitive values (SSH keys, AWX admin password) used by the Pipeline and AWX_Server
- **AWX_Admin_Password**: The AWX administrator password stored in Secrets_Manager, used for initial AWX API authentication
- **Health_Check_Endpoint**: An AWX API endpoint used by the Pipeline to verify the AWX_Server is operational before triggering jobs

## Requirements

### Requirement 1: AWX Server Provisioning via Terraform

**User Story:** As a DevOps engineer, I want an AWX server provisioned by Terraform as part of the infrastructure, so that AWX is managed as code alongside the rest of the environment.

#### Acceptance Criteria

1. THE AWX_Module SHALL provision an EC2 instance running AWX in the configured VPC
2. THE AWX_Module SHALL be located in the modules/awx/ directory following the same module structure as other Terraform modules in the project
3. THE AWX_Module SHALL install AWX on the EC2 instance using a Docker Compose-based deployment via user data or provisioning scripts
4. WHEN terraform apply completes, THE AWX_Server SHALL be running and accessible on port 80 within the VPC
5. THE AWX_Module SHALL provision a dedicated security group for the AWX_Server
6. THE AWX_Module SHALL expose outputs for the AWX_Server private IP, AWX_Server instance ID, and AWX security group ID
7. THE AWX_Module SHALL accept the VPC ID, subnet ID, and instance type as input variables

### Requirement 2: AWX Server Security Group Configuration

**User Story:** As a DevOps engineer, I want a dedicated security group for the AWX server, so that access to AWX is restricted to the VPC and authorized sources only.

#### Acceptance Criteria

1. THE AWX_Module SHALL provision a security group for the AWX_Server in the configured VPC
2. THE AWX security group SHALL allow inbound TCP traffic on port 80 (AWX web UI and API) from the VPC CIDR range
3. THE AWX security group SHALL allow inbound TCP traffic on port 443 (HTTPS) from the VPC CIDR range
4. THE AWX security group SHALL allow outbound TCP traffic on port 22 to the EC2 instance security group, so that AWX can SSH into target instances
5. THE AWX security group SHALL allow outbound TCP traffic on port 443 to 0.0.0.0/0, so that AWX can reach external Git repositories and container registries
6. THE AWX security group SHALL deny inbound traffic from the public internet on all ports

### Requirement 3: AWX Server Network Connectivity

**User Story:** As a DevOps engineer, I want the AWX server to have network connectivity to the target EC2 instances and to external Git repositories, so that AWX can pull playbooks and execute them on the target hosts.

#### Acceptance Criteria

1. THE AWX_Server SHALL be deployed in a subnet within the same VPC as the Auto_Scaling_Group target instances
2. THE EC2 instance security group SHALL allow inbound TCP traffic on port 22 from the AWX security group, so that AWX can SSH into target instances
3. THE AWX_Server SHALL have outbound internet access to clone Git repositories containing Ansible playbooks
4. WHEN the AWX_Server attempts to connect to a target EC2 instance on port 22, THE connection SHALL succeed without traversing the public internet

### Requirement 4: AWX Admin Credential Management

**User Story:** As a DevOps engineer, I want the AWX admin password stored in AWS Secrets Manager, so that no AWX credentials are hardcoded in Terraform or GitHub.

#### Acceptance Criteria

1. THE Secrets_Manager SHALL store the AWX_Admin_Password used for AWX API authentication
2. THE AWX_Module SHALL retrieve the AWX_Admin_Password from Secrets_Manager during provisioning to configure the AWX admin account
3. THE Pipeline SHALL retrieve the AWX_Admin_Password from Secrets_Manager at runtime to authenticate AWX_API calls
4. IF the Pipeline fails to retrieve the AWX_Admin_Password from Secrets_Manager, THEN THE Pipeline SHALL terminate the workflow with a non-zero exit code and a descriptive error message

### Requirement 5: AWX Project Configuration

**User Story:** As a DevOps engineer, I want AWX to reference the existing Git repository as a project, so that the existing Ansible playbooks (site.yml) are reused without modification.

#### Acceptance Criteria

1. THE AWX_Server SHALL have an AWX_Project configured that references the Git repository containing the Ansible playbooks
2. THE AWX_Project SHALL point to the repository directory structure where ansible/playbooks/site.yml is located
3. WHEN the AWX_Project is synced, THE AWX_Server SHALL have access to the site.yml playbook and all related Ansible files
4. IF the AWX_Project sync fails, THEN THE AWX_Server SHALL report the sync failure with a descriptive error in the AWX job log

### Requirement 6: AWX Credential Configuration for SSH

**User Story:** As a DevOps engineer, I want AWX to manage the SSH credentials for connecting to target EC2 instances, so that SSH keys are no longer handled by the GitHub Actions runner.

#### Acceptance Criteria

1. THE AWX_Server SHALL have an AWX_Credential of type "Machine" configured with the SSH private key for connecting to target EC2 instances
2. THE AWX_Credential SHALL use the SSH private key stored in Secrets_Manager
3. THE AWX_Credential SHALL specify "ec2-user" as the SSH username
4. WHEN a Job_Template is executed, THE AWX_Server SHALL use the AWX_Credential to authenticate SSH connections to target EC2 instances
5. THE Pipeline SHALL no longer retrieve or handle SSH private keys for Ansible execution

### Requirement 7: AWX Dynamic Inventory Configuration

**User Story:** As a DevOps engineer, I want AWX to use a dynamic inventory sourced from the Auto Scaling Group, so that AWX always targets the current set of running EC2 instances.

#### Acceptance Criteria

1. THE AWX_Server SHALL have an AWX_Inventory configured that lists the target EC2 instances
2. THE AWX_Inventory SHALL be updated with the current EC2 instance IPs from the Auto_Scaling_Group before each job execution
3. THE Pipeline SHALL pass the current Auto_Scaling_Group instance IPs to AWX when triggering a job, so that AWX targets the correct hosts
4. WHEN a new EC2 instance is launched by the Auto_Scaling_Group, THE AWX_Inventory SHALL include the new instance IP after the next inventory update
5. THE AWX_Inventory SHALL group target hosts under the "dev_instances" group to match the existing playbook host pattern

### Requirement 8: AWX Job Template Configuration

**User Story:** As a DevOps engineer, I want an AWX job template configured to run the site.yml playbook, so that the existing Ansible configuration is executed through AWX.

#### Acceptance Criteria

1. THE AWX_Server SHALL have a Job_Template configured that references the site.yml playbook from the AWX_Project
2. THE Job_Template SHALL reference the AWX_Inventory as the target inventory
3. THE Job_Template SHALL reference the AWX_Credential for SSH authentication
4. THE Job_Template SHALL enable privilege escalation (become: true) to match the existing playbook requirements
5. THE Job_Template SHALL accept extra variables to allow the Pipeline to pass runtime parameters

### Requirement 9: GitHub Actions AWX Job Trigger

**User Story:** As a DevOps engineer, I want the GitHub Actions apply workflow to trigger an AWX job via the API instead of running Ansible directly, so that Ansible execution is managed by AWX.

#### Acceptance Criteria

1. WHEN terraform apply completes successfully and the Auto_Scaling_Group contains running EC2 instances, THE Pipeline SHALL trigger a Job_Template launch via the AWX_API
2. THE Pipeline SHALL authenticate to the AWX_API using the AWX_Admin_Password retrieved from Secrets_Manager
3. THE Pipeline SHALL pass the current Auto_Scaling_Group instance IPs as extra variables or inventory updates to the AWX_API when launching the job
4. THE Pipeline SHALL use the AWX_Server private IP to reach the AWX_API (not a public endpoint)
5. IF the AWX_API returns an error response when launching the job, THEN THE Pipeline SHALL terminate the workflow with a non-zero exit code and log the error response body

### Requirement 10: AWX Job Polling and Completion Monitoring

**User Story:** As a DevOps engineer, I want the GitHub Actions pipeline to poll the AWX job status and wait for completion, so that the pipeline reflects the actual outcome of the Ansible execution.

#### Acceptance Criteria

1. WHEN the Pipeline launches an AWX job, THE Pipeline SHALL poll the AWX_API for the job status at a regular interval of 15 seconds
2. WHILE the AWX job status is "pending" or "running", THE Pipeline SHALL continue polling and log the current status to the GitHub Actions workflow log
3. WHEN the AWX job status changes to "successful", THE Pipeline SHALL log the job completion and continue the workflow
4. IF the AWX job status changes to "failed" or "error", THEN THE Pipeline SHALL retrieve the job output from the AWX_API, log the output to the GitHub Actions workflow log, and terminate the workflow with a non-zero exit code
5. IF the AWX job does not complete within 600 seconds, THEN THE Pipeline SHALL terminate the workflow with a non-zero exit code and a timeout error message

### Requirement 11: AWX Server Health Check Before Job Launch

**User Story:** As a DevOps engineer, I want the pipeline to verify AWX is healthy before triggering a job, so that the pipeline fails fast with a clear error if AWX is not ready.

#### Acceptance Criteria

1. WHEN terraform apply completes, THE Pipeline SHALL send a health check request to the AWX_API ping endpoint before attempting to launch a job
2. IF the AWX_Server does not respond to the health check within 300 seconds, THEN THE Pipeline SHALL terminate the workflow with a non-zero exit code and a descriptive error message indicating AWX is not ready
3. THE Pipeline SHALL retry the health check request every 10 seconds until the AWX_Server responds or the timeout is reached

### Requirement 12: Removal of Direct Ansible Execution from Pipeline

**User Story:** As a DevOps engineer, I want the direct ansible-playbook execution steps removed from the GitHub Actions apply workflow, so that Ansible is executed exclusively through AWX.

#### Acceptance Criteria

1. THE Pipeline SHALL remove the "Generate Ansible inventory from ASG" step from the apply workflow
2. THE Pipeline SHALL remove the "Run Ansible Playbook" step from the apply workflow
3. THE Pipeline SHALL no longer retrieve the SSH private key from Secrets_Manager for Ansible execution purposes
4. THE Pipeline SHALL retain the SSH public key retrieval from Secrets_Manager for Terraform EC2 key pair provisioning
5. WHEN the apply workflow runs, THE Pipeline SHALL execute Ansible playbooks exclusively via AWX_API calls

### Requirement 13: AWX Server Integration in Environment Configuration

**User Story:** As a DevOps engineer, I want the AWX module integrated into the environment configuration, so that the AWX server is provisioned alongside the existing infrastructure.

#### Acceptance Criteria

1. THE environment configuration (environments/dev-github/main.tf) SHALL include the AWX_Module alongside the existing networking, ALB, compute_asg, storage, and cloudwatch modules
2. THE AWX_Module SHALL receive the VPC ID and subnet ID from the networking module outputs
3. THE AWX_Module SHALL receive the EC2 instance security group ID from the compute_asg module to configure SSH access rules
4. WHEN terraform apply completes, THE environment SHALL output the AWX_Server private IP for use by the Pipeline
5. THE environment configuration SHALL include a Terraform variable to enable or disable AWX provisioning

### Requirement 14: Pipeline Configuration for AWX Integration

**User Story:** As a DevOps engineer, I want the pipeline to use non-sensitive GitHub Actions variables for AWX configuration, so that the AWX integration follows the existing zero-secrets-in-GitHub pattern.

#### Acceptance Criteria

1. THE Pipeline SHALL read the AWX_Admin_Password Secrets_Manager secret name from a GitHub Actions variable or a hardcoded workflow value
2. THE Pipeline SHALL read the AWX Job_Template ID or name from a GitHub Actions variable or a hardcoded workflow value
3. THE Pipeline SHALL derive the AWX_Server private IP from Terraform outputs at runtime
4. THE Pipeline SHALL store zero AWX-related credentials or secrets in GitHub Actions secrets
