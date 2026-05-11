#!/bin/bash
set -euo pipefail

# AWX Bootstrap Script (k3s + AWX Operator)
# Environment: ${environment}
# This script installs k3s, deploys AWX via the AWX Operator,
# and configures AWX resources (project, credential, inventory, job template).

exec > >(tee /var/log/awx-bootstrap.log) 2>&1
echo "=== AWX Bootstrap started at $$(date) ==="

# -------------------------------------------------------
# 1. Get AWS region from instance metadata
# -------------------------------------------------------
echo ">>> Retrieving AWS region from instance metadata..."
TOKEN=$$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
AWS_REGION=$$(curl -s -H "X-aws-ec2-metadata-token: $$TOKEN" \
  http://169.254.169.254/latest/meta-data/placement/region)
echo "AWS Region: $$AWS_REGION"

# -------------------------------------------------------
# 2. Install prerequisites on Amazon Linux 2023
# -------------------------------------------------------
echo ">>> Installing prerequisites..."
dnf update -y
dnf install -y jq curl

# -------------------------------------------------------
# 3. Install k3s (lightweight Kubernetes)
# -------------------------------------------------------
echo ">>> Installing k3s..."
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable=traefik" sh -

echo ">>> Waiting for k3s to be ready..."
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
K3S_MAX_WAIT=120
K3S_ELAPSED=0
K3S_INTERVAL=5

while [ $$K3S_ELAPSED -lt $$K3S_MAX_WAIT ]; do
  if kubectl get nodes 2>/dev/null | grep -q " Ready"; then
    echo "k3s is ready after $${K3S_ELAPSED}s"
    break
  fi
  echo "k3s not ready yet, retrying in $${K3S_INTERVAL}s... ($${K3S_ELAPSED}s elapsed)"
  sleep $$K3S_INTERVAL
  K3S_ELAPSED=$$((K3S_ELAPSED + K3S_INTERVAL))
done

if [ $$K3S_ELAPSED -ge $$K3S_MAX_WAIT ]; then
  echo "ERROR: k3s did not become ready within $${K3S_MAX_WAIT}s"
  exit 1
fi

echo "k3s version: $$(k3s --version)"
echo "kubectl version: $$(kubectl version --short 2>/dev/null || kubectl version)"

# -------------------------------------------------------
# 4. Deploy AWX Operator
# -------------------------------------------------------
AWX_OPERATOR_VERSION="2.19.0"
echo ">>> Deploying AWX Operator v$${AWX_OPERATOR_VERSION}..."

# Create the awx namespace and deploy the operator via kustomize
cat > /tmp/kustomization.yaml <<'KUSTOM_EOF'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - github.com/ansible/awx-operator/config/default?ref=2.19.0
images:
  - name: quay.io/ansible/awx-operator
    newTag: 2.19.0
namespace: awx
KUSTOM_EOF

kubectl create namespace awx --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -k /tmp/

echo ">>> Waiting for AWX Operator to be ready..."
OPERATOR_MAX_WAIT=300
OPERATOR_ELAPSED=0
OPERATOR_INTERVAL=10

while [ $$OPERATOR_ELAPSED -lt $$OPERATOR_MAX_WAIT ]; do
  READY=$$(kubectl get deployment -n awx awx-operator-controller-manager -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  if [ "$$READY" = "1" ]; then
    echo "AWX Operator is ready after $${OPERATOR_ELAPSED}s"
    break
  fi
  echo "AWX Operator not ready yet (ready replicas: $$READY), retrying in $${OPERATOR_INTERVAL}s... ($${OPERATOR_ELAPSED}s elapsed)"
  sleep $$OPERATOR_INTERVAL
  OPERATOR_ELAPSED=$$((OPERATOR_ELAPSED + OPERATOR_INTERVAL))
done

if [ $$OPERATOR_ELAPSED -ge $$OPERATOR_MAX_WAIT ]; then
  echo "ERROR: AWX Operator did not become ready within $${OPERATOR_MAX_WAIT}s"
  exit 1
fi

# -------------------------------------------------------
# 5. Deploy AWX custom resource
# -------------------------------------------------------
echo ">>> Creating AWX custom resource..."
cat <<'AWX_CR_EOF' | kubectl apply -f -
apiVersion: awx.ansible.com/v1beta1
kind: AWX
metadata:
  name: awx
  namespace: awx
spec:
  service_type: NodePort
  nodeport_port: 80
  projects_persistence: true
  projects_storage_size: 2Gi
AWX_CR_EOF

# -------------------------------------------------------
# 6. Wait for AWX pods to be ready
# -------------------------------------------------------
echo ">>> Waiting for AWX pods to be ready..."
AWX_POD_MAX_WAIT=600
AWX_POD_ELAPSED=0
AWX_POD_INTERVAL=15

while [ $$AWX_POD_ELAPSED -lt $$AWX_POD_MAX_WAIT ]; do
  WEB_READY=$$(kubectl get pods -n awx -l app.kubernetes.io/name=awx-web -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "False")
  TASK_READY=$$(kubectl get pods -n awx -l app.kubernetes.io/name=awx-task -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "False")
  if [ "$$WEB_READY" = "True" ] && [ "$$TASK_READY" = "True" ]; then
    echo "AWX pods are ready after $${AWX_POD_ELAPSED}s"
    break
  fi
  echo "AWX pods not ready yet (web=$$WEB_READY, task=$$TASK_READY), retrying in $${AWX_POD_INTERVAL}s... ($${AWX_POD_ELAPSED}s elapsed)"
  sleep $$AWX_POD_INTERVAL
  AWX_POD_ELAPSED=$$((AWX_POD_ELAPSED + AWX_POD_INTERVAL))
done

if [ $$AWX_POD_ELAPSED -ge $$AWX_POD_MAX_WAIT ]; then
  echo "ERROR: AWX pods did not become ready within $${AWX_POD_MAX_WAIT}s"
  echo "Pod status:"
  kubectl get pods -n awx
  exit 1
fi

# -------------------------------------------------------
# 7. Wait for AWX API to become available on port 80
# -------------------------------------------------------
echo ">>> Waiting for AWX API to become available..."
AWX_URL="http://localhost:80/api/v2/ping/"
MAX_WAIT=300
INTERVAL=10
ELAPSED=0

while [ $$ELAPSED -lt $$MAX_WAIT ]; do
  HTTP_CODE=$$(curl -s -o /dev/null -w "%%{http_code}" "$$AWX_URL" 2>/dev/null || echo "000")
  if [ "$$HTTP_CODE" = "200" ]; then
    echo "AWX API is available (HTTP $$HTTP_CODE) after $${ELAPSED}s"
    break
  fi
  echo "AWX API not ready yet (HTTP $$HTTP_CODE), retrying in $${INTERVAL}s... ($${ELAPSED}s elapsed)"
  sleep $$INTERVAL
  ELAPSED=$$((ELAPSED + INTERVAL))
done

if [ $$ELAPSED -ge $$MAX_WAIT ]; then
  echo "ERROR: AWX API did not become available within $${MAX_WAIT}s"
  exit 1
fi

# -------------------------------------------------------
# 8. Retrieve secrets from AWS Secrets Manager
# -------------------------------------------------------
echo ">>> Retrieving AWX admin password from Secrets Manager..."
AWX_ADMIN_PASSWORD=$$(aws secretsmanager get-secret-value \
  --secret-id "${awx_admin_password_secret_id}" \
  --region "$$AWS_REGION" \
  --query 'SecretString' --output text)
echo "AWX admin password retrieved successfully"

echo ">>> Retrieving SSH private key from Secrets Manager..."
SSH_PRIVATE_KEY=$$(aws secretsmanager get-secret-value \
  --secret-id "${ssh_private_key_secret_id}" \
  --region "$$AWS_REGION" \
  --query 'SecretString' --output text)
echo "SSH private key retrieved successfully"

# -------------------------------------------------------
# 9. Set AWX admin password
# -------------------------------------------------------
echo ">>> Setting AWX admin password..."
AWX_WEB_POD=$$(kubectl get pods -n awx -l app.kubernetes.io/name=awx-web -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n awx "$$AWX_WEB_POD" -c awx-web -- awx-manage update_password --username=admin --password="$$AWX_ADMIN_PASSWORD"
echo "AWX admin password updated"

AWX_API="http://localhost:80"
AWX_AUTH="-u admin:$$AWX_ADMIN_PASSWORD"

# Helper function for AWX API calls
awx_api() {
  local method="$$1"
  local endpoint="$$2"
  local data="$${3:-}"

  if [ -n "$$data" ]; then
    curl -s $$AWX_AUTH -H "Content-Type: application/json" \
      -X "$$method" "$$AWX_API$$endpoint" -d "$$data"
  else
    curl -s $$AWX_AUTH -H "Content-Type: application/json" \
      -X "$$method" "$$AWX_API$$endpoint"
  fi
}

# -------------------------------------------------------
# 10. Get the Default organization ID
# -------------------------------------------------------
echo ">>> Getting Default organization..."
ORG_ID=$$(awx_api GET "/api/v2/organizations/?name=Default" | jq -r '.results[0].id')
echo "Default organization ID: $$ORG_ID"

# -------------------------------------------------------
# 11. Create Project
# -------------------------------------------------------
echo ">>> Creating AWX project: ${environment}-ansible-project..."
PROJECT_RESPONSE=$$(awx_api POST "/api/v2/projects/" "{
  \"name\": \"${environment}-ansible-project\",
  \"organization\": $$ORG_ID,
  \"scm_type\": \"git\",
  \"scm_url\": \"${awx_project_git_url}\",
  \"scm_branch\": \"main\",
  \"scm_update_on_launch\": true
}")
PROJECT_ID=$$(echo "$$PROJECT_RESPONSE" | jq -r '.id')
echo "Project created with ID: $$PROJECT_ID"

# -------------------------------------------------------
# 12. Get Machine credential type ID
# -------------------------------------------------------
echo ">>> Getting Machine credential type ID..."
MACHINE_CRED_TYPE_ID=$$(awx_api GET "/api/v2/credential_types/?name=Machine" | jq -r '.results[0].id')
echo "Machine credential type ID: $$MACHINE_CRED_TYPE_ID"

# -------------------------------------------------------
# 13. Create Machine Credential with SSH key
# -------------------------------------------------------
echo ">>> Creating Machine credential: ${environment}-ssh-credential..."
SSH_KEY_JSON=$$(echo "$$SSH_PRIVATE_KEY" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')

CREDENTIAL_RESPONSE=$$(awx_api POST "/api/v2/credentials/" "{
  \"name\": \"${environment}-ssh-credential\",
  \"organization\": $$ORG_ID,
  \"credential_type\": $$MACHINE_CRED_TYPE_ID,
  \"inputs\": {
    \"username\": \"ec2-user\",
    \"ssh_key_data\": $$SSH_KEY_JSON
  }
}")
CREDENTIAL_ID=$$(echo "$$CREDENTIAL_RESPONSE" | jq -r '.id')
echo "Credential created with ID: $$CREDENTIAL_ID"

# -------------------------------------------------------
# 14. Create Inventory
# -------------------------------------------------------
echo ">>> Creating inventory: dev-inventory..."
INVENTORY_RESPONSE=$$(awx_api POST "/api/v2/inventories/" "{
  \"name\": \"dev-inventory\",
  \"organization\": $$ORG_ID
}")
INVENTORY_ID=$$(echo "$$INVENTORY_RESPONSE" | jq -r '.id')
echo "Inventory created with ID: $$INVENTORY_ID"

# -------------------------------------------------------
# 15. Create Host Group in Inventory
# -------------------------------------------------------
echo ">>> Creating host group: dev_instances..."
GROUP_RESPONSE=$$(awx_api POST "/api/v2/inventories/$$INVENTORY_ID/groups/" "{
  \"name\": \"dev_instances\"
}")
GROUP_ID=$$(echo "$$GROUP_RESPONSE" | jq -r '.id')
echo "Host group created with ID: $$GROUP_ID"

# -------------------------------------------------------
# 16. Create Job Template
# -------------------------------------------------------
echo ">>> Creating job template: site-yml..."
JOB_TEMPLATE_RESPONSE=$$(awx_api POST "/api/v2/job_templates/" "{
  \"name\": \"site-yml\",
  \"project\": $$PROJECT_ID,
  \"playbook\": \"ansible/playbooks/site.yml\",
  \"inventory\": $$INVENTORY_ID,
  \"become_enabled\": true,
  \"ask_variables_on_launch\": true
}")
JOB_TEMPLATE_ID=$$(echo "$$JOB_TEMPLATE_RESPONSE" | jq -r '.id')
echo "Job template created with ID: $$JOB_TEMPLATE_ID"

echo ">>> Associating credential with job template..."
awx_api POST "/api/v2/job_templates/$$JOB_TEMPLATE_ID/credentials/" "{
  \"id\": $$CREDENTIAL_ID
}"
echo "Credential associated with job template"

# -------------------------------------------------------
# 17. Sync the project to pull playbooks from Git
# -------------------------------------------------------
echo ">>> Syncing project to pull playbooks from Git..."
awx_api POST "/api/v2/projects/$$PROJECT_ID/update/" ""

echo ">>> Waiting for project sync..."
SYNC_MAX_WAIT=300
SYNC_ELAPSED=0
SYNC_INTERVAL=10

while [ $$SYNC_ELAPSED -lt $$SYNC_MAX_WAIT ]; do
  PROJECT_STATUS=$$(awx_api GET "/api/v2/projects/$$PROJECT_ID/" | jq -r '.status')
  if [ "$$PROJECT_STATUS" = "successful" ]; then
    echo "Project sync completed successfully"
    break
  elif [ "$$PROJECT_STATUS" = "failed" ] || [ "$$PROJECT_STATUS" = "error" ]; then
    echo "ERROR: Project sync failed with status: $$PROJECT_STATUS"
    exit 1
  fi
  echo "Project sync status: $$PROJECT_STATUS, waiting $${SYNC_INTERVAL}s... ($${SYNC_ELAPSED}s elapsed)"
  sleep $$SYNC_INTERVAL
  SYNC_ELAPSED=$$((SYNC_ELAPSED + SYNC_INTERVAL))
done

if [ $$SYNC_ELAPSED -ge $$SYNC_MAX_WAIT ]; then
  echo "ERROR: Project sync did not complete within $${SYNC_MAX_WAIT}s"
  exit 1
fi

echo "=== AWX Bootstrap completed successfully at $$(date) ==="
