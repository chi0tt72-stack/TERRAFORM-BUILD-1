import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..', '..');

const userDataTemplate = readFileSync(
  resolve(ROOT, 'modules/awx/templates/user_data.sh.tpl'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Validates: Requirement 1.3 — AWX installed on EC2 via user_data
// The bootstrap uses k3s + AWX Operator (not Docker Compose).
// ---------------------------------------------------------------------------
describe('AWX bootstrap script — k3s installation', () => {
  it('installs k3s', () => {
    expect(userDataTemplate).toContain('https://get.k3s.io');
  });

  it('waits for k3s to be ready', () => {
    expect(userDataTemplate).toMatch(/kubectl get nodes/);
  });

  it('deploys the AWX Operator via kustomize', () => {
    expect(userDataTemplate).toMatch(/awx-operator/);
    expect(userDataTemplate).toMatch(/kubectl apply -k/);
  });

  it('creates an AWX custom resource', () => {
    expect(userDataTemplate).toMatch(/kind:\s*AWX/);
  });
});

// ---------------------------------------------------------------------------
// Validates: Requirements 5.1, 5.2 — AWX Project configuration
// ---------------------------------------------------------------------------
describe('AWX bootstrap script — project configuration', () => {
  it('creates a project with scm_type git', () => {
    expect(userDataTemplate).toMatch(/scm_type.*git/);
  });

  it('references the awx_project_git_url variable', () => {
    expect(userDataTemplate).toContain('${awx_project_git_url}');
  });

  it('enables scm_update_on_launch', () => {
    expect(userDataTemplate).toMatch(/scm_update_on_launch.*true/);
  });
});

// ---------------------------------------------------------------------------
// Validates: Requirements 6.1, 6.2, 6.3 — Machine Credential with ec2-user
// ---------------------------------------------------------------------------
describe('AWX bootstrap script — credential configuration', () => {
  it('creates a Machine credential', () => {
    expect(userDataTemplate).toMatch(/Machine credential/i);
  });

  it('uses ec2-user as the SSH username', () => {
    expect(userDataTemplate).toMatch(/username.*ec2-user/);
  });

  it('retrieves the SSH private key from Secrets Manager', () => {
    expect(userDataTemplate).toContain('${ssh_private_key_secret_id}');
  });
});

// ---------------------------------------------------------------------------
// Validates: Requirements 7.1, 7.5 — Inventory with dev_instances group
// ---------------------------------------------------------------------------
describe('AWX bootstrap script — inventory configuration', () => {
  it('creates an inventory named dev-inventory', () => {
    expect(userDataTemplate).toMatch(/dev-inventory/);
  });

  it('creates a host group named dev_instances', () => {
    expect(userDataTemplate).toMatch(/dev_instances/);
  });
});

// ---------------------------------------------------------------------------
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5 — Job Template
// ---------------------------------------------------------------------------
describe('AWX bootstrap script — job template configuration', () => {
  it('creates a job template named site-yml', () => {
    expect(userDataTemplate).toMatch(/site-yml/);
    expect(userDataTemplate).toMatch(/job.template/i);
  });

  it('references the site.yml playbook', () => {
    expect(userDataTemplate).toContain('ansible/playbooks/site.yml');
  });

  it('enables become (privilege escalation)', () => {
    expect(userDataTemplate).toMatch(/become_enabled.*true/);
  });

  it('enables ask_variables_on_launch', () => {
    expect(userDataTemplate).toMatch(/ask_variables_on_launch.*true/);
  });
});
