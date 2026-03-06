# GitLab CI/CD Pipeline

## Pipeline Configuration

```bash 
File: .gitlab-ci.yml
```

#### Stages:

validate - Runs terraform fmt -check and terraform validate


plan - Runs terraform plan -out=plan.tfplan


apply - Runs terraform apply plan.tfplan (manual trigger required)

### Pipeline Stage Details

```mermaid
stateDiagram-v2
    [*] --> Validate
    Validate --> FormatCheck
    FormatCheck --> SyntaxCheck
    SyntaxCheck --> Plan: Pass
    FormatCheck --> Failed: Fail
    SyntaxCheck --> Failed: Fail
    
    Plan --> TerraformInit
    TerraformInit --> TerraformPlan
    TerraformPlan --> SaveArtifact
    SaveArtifact --> WaitingApproval
    
    WaitingApproval --> Apply: Manual Approval
    WaitingApproval --> Cancelled: Rejected
    
    Apply --> TerraformApply
    TerraformApply --> Success
    TerraformApply --> Failed: Error
    
    Success --> [*]
    Failed --> [*]
    Cancelled --> [*]
```

### Backend Configuration

Terraform state is stored remotely in GitLab HTTP backend:

- **State location:** GitLab project terraform state storage
- **State locking:** Enabled (prevents concurrent modifications)
- **State versioning:** Automatic via GitLab

### Triggering Deployments

Automatic triggers:

- **Any push to main branch triggers validate and plan stages**

Manual triggers:

- Apply stage must be manually triggered in GitLab UI
- Provides safety against accidental deployments


### Viewing Pipeline


1. Go to https://gitlab.com/chi0tt72-stack/terraformioctest
2. Click CI/CD → Pipelines
3. Click on latest pipeline
4. Review plan output
5. Click Play button on apply stage when ready

---

## Security Implementation

Secrets Management Strategy

```mermaid
graph LR
    subgraph "Never in Git"
        PK[Private SSH Key<br/>~/.ssh/terraform-course-key]
        AWS[AWS Credentials]
        TFVARS[terraform.tfvars]
        STATE[*.tfstate files]
    end
    
    subgraph "In AWS Secrets Manager"
        PUBKEY[Public SSH Key<br/>terraform/ssh-public-key]
    end
    
    subgraph "In Git Repository"
        CODE[Terraform Code<br/>*.tf files]
        IGNORE[.gitignore]
        CI[.gitlab-ci.yml]
    end
    
    PK -.->|Protected by| IGNORE
    AWS -.->|Protected by| IGNORE
    TFVARS -.->|Protected by| IGNORE
    STATE -.->|Protected by| IGNORE
    
    CODE -->|Reads from| PUBKEY
    
    style PK fill:#EA4335
    style AWS fill:#EA4335
    style PUBKEY fill:#34A853
    style CODE fill:#4285F4
```

### What's in AWS Secrets Manager

- SSH public key (terraform/ssh-public-key)


### What's in .gitignore

*.tfstate - Terraform state files

*.tfstate.* - Terraform state backups

.terraform/ - Provider plugins

terraform.tfvars - Variable values

- `*.tfvars` - All variable files

### What's NEVER committed

- AWS credentials
- SSH private keys
- Terraform state files
- Sensitive variable values

### SSH Key Management

*** Private key location:** ~/.ssh/terraform-course-key (local only) *** Public key location: *** AWS Secrets Manager terraform/ssh-public-key

###How it works:

- Terraform reads public key from Secrets Manager
- Creates AWS key pair with that public key
- EC2 instance launched with that key pair
- I SSH using my local private key

### Network Security

Security groups configured:

- SSH (port 22) - Restricted to my IP
- HTTPS (port 443) - For outbound updates
- HTTP (port 80) - For outbound package downloads

### S3 Bucket Security

- Server-side encryption (AES256)
- Versioning enabled
- Access logging enabled
= Public access blocked

