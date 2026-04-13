# Requirements Document

## Introduction

This feature adds blue/green deployment capability to the existing Terraform + Ansible CI/CD pipeline orchestrated by GitHub Actions. The goal is zero-downtime deployments by provisioning a new environment (green) alongside the existing one (blue), verifying the green environment, switching ALB traffic, and tearing down the old blue environment. GitHub Actions orchestrates the full lifecycle with manual approval gates at critical cutover points.

## Glossary

- **Deployment_Pipeline**: The GitHub Actions workflow that orchestrates the blue/green deployment lifecycle from provisioning through cutover to cleanup
- **ALB**: The existing AWS Application Load Balancer (`{environment}-alb`) that routes HTTP traffic to backend instances
- **Blue_Environment**: The currently active ASG and its associated target group serving production traffic through the ALB
- **Green_Environment**: The newly provisioned ASG and its associated target group created during a deployment, not yet receiving production traffic
- **Target_Group**: An AWS ALB target group that registers EC2 instances from an ASG for health-checked traffic routing
- **Listener**: The ALB HTTP listener on port 80 whose default action forwards traffic to either the blue or green Target_Group
- **Cutover**: The operation of switching the ALB Listener's forwarding rule from the Blue_Environment Target_Group to the Green_Environment Target_Group
- **Approval_Gate**: A GitHub Actions environment protection rule requiring manual approval before a workflow job proceeds
- **Health_Check**: The ALB target group health check that verifies EC2 instances are responding on port 80
- **Ansible_Provisioner**: The Ansible playbook execution step that configures EC2 instances with the application stack (Apache, PHP, MariaDB client)
- **Deployment_Slot**: A label (blue or green) identifying which ASG and Target_Group pair is currently active or standby
- **Terraform_State**: The S3-backed Terraform state that tracks which Deployment_Slot is currently active
- **Smoke_Test**: An automated HTTP request to the Green_Environment Target_Group to verify the application responds correctly before Cutover

## Requirements

### Requirement 1: Green Environment Provisioning

**User Story:** As a DevOps engineer, I want the pipeline to create a new ASG and target group alongside the existing one, so that I can deploy new code without affecting live traffic.

#### Acceptance Criteria

1. WHEN a blue/green deployment is triggered, THE Deployment_Pipeline SHALL create a new Green_Environment ASG with the same instance configuration (instance type, AMI, security groups, subnets) as the Blue_Environment ASG
2. WHEN a blue/green deployment is triggered, THE Deployment_Pipeline SHALL create a new Green_Environment Target_Group registered with the Green_Environment ASG
3. WHILE the Green_Environment is being provisioned, THE Blue_Environment SHALL continue serving all production traffic through the ALB Listener
4. WHEN the Green_Environment ASG instances reach InService state, THE Deployment_Pipeline SHALL execute the Ansible_Provisioner against the Green_Environment instances only
5. THE Green_Environment ASG SHALL use the same min_size, desired_capacity, and max_size parameters as the Blue_Environment ASG

### Requirement 2: Green Environment Health Verification

**User Story:** As a DevOps engineer, I want the pipeline to verify the green environment is healthy before switching traffic, so that I avoid routing users to broken instances.

#### Acceptance Criteria

1. WHEN the Ansible_Provisioner completes on the Green_Environment, THE Deployment_Pipeline SHALL wait for all Green_Environment instances to pass the Target_Group Health_Check
2. WHEN all Green_Environment instances pass the Health_Check, THE Deployment_Pipeline SHALL execute a Smoke_Test by sending an HTTP request to the Green_Environment Target_Group
3. IF any Green_Environment instance fails the Health_Check within 300 seconds, THEN THE Deployment_Pipeline SHALL mark the deployment as failed and stop before Cutover
4. IF the Smoke_Test returns a non-200 HTTP status code, THEN THE Deployment_Pipeline SHALL mark the deployment as failed and stop before Cutover

### Requirement 3: Manual Approval Gate Before Cutover

**User Story:** As a DevOps engineer, I want a manual approval step before switching traffic to the green environment, so that I can perform additional validation and control the cutover timing.

#### Acceptance Criteria

1. WHEN the Green_Environment passes all Health_Checks and the Smoke_Test, THE Deployment_Pipeline SHALL pause and wait for an Approval_Gate before proceeding to Cutover
2. THE Approval_Gate SHALL use a GitHub Actions environment protection rule requiring at least one reviewer approval
3. IF the Approval_Gate is rejected, THEN THE Deployment_Pipeline SHALL skip the Cutover and proceed to cleanup of the Green_Environment
4. IF the Approval_Gate is not approved within 72 hours, THEN THE Deployment_Pipeline SHALL time out and skip the Cutover

### Requirement 4: ALB Traffic Cutover

**User Story:** As a DevOps engineer, I want the ALB listener to switch from the blue target group to the green target group atomically, so that users experience zero downtime during deployment.

#### Acceptance Criteria

1. WHEN the Approval_Gate is approved, THE Deployment_Pipeline SHALL update the ALB Listener default action to forward traffic to the Green_Environment Target_Group
2. THE Deployment_Pipeline SHALL perform the Listener update as a single Terraform apply operation to ensure atomic switching
3. WHEN the Cutover completes, THE Deployment_Pipeline SHALL verify the ALB Listener is forwarding to the Green_Environment Target_Group
4. IF the Cutover Terraform apply fails, THEN THE Deployment_Pipeline SHALL leave the ALB Listener pointing to the Blue_Environment Target_Group

### Requirement 5: Blue Environment Cleanup

**User Story:** As a DevOps engineer, I want the old blue environment to be torn down after a successful cutover, so that I avoid paying for idle resources.

#### Acceptance Criteria

1. WHEN the Cutover is verified successful, THE Deployment_Pipeline SHALL destroy the Blue_Environment ASG and its associated Target_Group
2. WHEN the Blue_Environment is destroyed, THE Terraform_State SHALL record the Green_Environment as the new active Blue_Environment (relabeling green to blue)
3. IF the Blue_Environment cleanup fails, THEN THE Deployment_Pipeline SHALL report the failure without reverting the Cutover
4. THE Deployment_Pipeline SHALL wait for a second Approval_Gate before destroying the Blue_Environment to allow rollback

### Requirement 6: Rollback Capability

**User Story:** As a DevOps engineer, I want to roll back to the blue environment if the green environment has issues after cutover, so that I can recover from failed deployments.

#### Acceptance Criteria

1. WHILE the Blue_Environment still exists after Cutover, THE Deployment_Pipeline SHALL support a manual rollback action that switches the ALB Listener back to the Blue_Environment Target_Group
2. WHEN a rollback is triggered, THE Deployment_Pipeline SHALL update the ALB Listener default action to forward traffic to the Blue_Environment Target_Group
3. WHEN a rollback completes, THE Deployment_Pipeline SHALL destroy the Green_Environment ASG and its associated Target_Group
4. IF the rollback Listener update fails, THEN THE Deployment_Pipeline SHALL report the failure and preserve both environments for manual intervention

### Requirement 7: Terraform Module for Dual ASG Support

**User Story:** As a DevOps engineer, I want the Terraform modules to support two ASG and target group pairs simultaneously, so that blue and green environments can coexist.

#### Acceptance Criteria

1. THE ALB module SHALL support outputting ARNs for two Target_Groups (blue and green) simultaneously
2. THE compute-asg module SHALL accept a Deployment_Slot label (blue or green) to differentiate resource names and tags
3. THE environment root module SHALL accept a variable indicating which Deployment_Slot is currently active for ALB Listener routing
4. THE ALB module SHALL accept a variable specifying which Target_Group ARN the Listener forwards to
5. WHEN both Deployment_Slots are provisioned, THE networking module and ALB module SHALL be shared between the Blue_Environment and Green_Environment

### Requirement 8: Ansible Inventory Generation for Green Environment

**User Story:** As a DevOps engineer, I want Ansible inventory to be generated dynamically for the green ASG instances, so that Ansible configures only the new instances.

#### Acceptance Criteria

1. WHEN the Green_Environment ASG instances are InService, THE Deployment_Pipeline SHALL generate an Ansible inventory file containing only the Green_Environment instance IPs
2. THE Deployment_Pipeline SHALL use the Green_Environment ASG name to query instance IPs from AWS
3. THE Ansible_Provisioner SHALL run the same site.yml playbook against the Green_Environment inventory as used for the Blue_Environment
4. IF the Ansible_Provisioner fails on the Green_Environment, THEN THE Deployment_Pipeline SHALL mark the deployment as failed and stop before Health_Check verification

### Requirement 9: Deployment State Tracking

**User Story:** As a DevOps engineer, I want the pipeline to track which slot (blue or green) is currently active, so that subsequent deployments target the correct standby slot.

#### Acceptance Criteria

1. THE Terraform_State SHALL store which Deployment_Slot (blue or green) is currently serving production traffic
2. WHEN a new deployment starts, THE Deployment_Pipeline SHALL read the current active Deployment_Slot from Terraform_State and provision the opposite slot as the Green_Environment
3. WHEN the Cutover and Blue_Environment cleanup complete, THE Terraform_State SHALL reflect the new active Deployment_Slot
4. IF no Deployment_Slot information exists in Terraform_State, THEN THE Deployment_Pipeline SHALL treat the existing environment as blue and provision green

### Requirement 10: GitHub Actions Workflow Structure

**User Story:** As a DevOps engineer, I want a dedicated GitHub Actions workflow for blue/green deployments, so that the deployment process is separate from regular infrastructure changes.

#### Acceptance Criteria

1. THE Deployment_Pipeline SHALL be defined as a new GitHub Actions workflow file separate from the existing terraform-apply.yml workflow
2. THE Deployment_Pipeline SHALL use the same OIDC authentication mechanism as the existing workflows (zero secrets in GitHub)
3. THE Deployment_Pipeline SHALL support manual triggering via workflow_dispatch with an optional input for the target branch
4. THE Deployment_Pipeline SHALL use the existing S3 backend for Terraform state
5. WHEN the Deployment_Pipeline runs, THE Deployment_Pipeline SHALL output a summary of each phase (provision, verify, cutover, cleanup) with status indicators
