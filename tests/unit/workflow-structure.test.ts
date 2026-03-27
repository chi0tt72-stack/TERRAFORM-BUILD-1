import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..', '..');

function loadWorkflow(name: string): any {
  const content = readFileSync(resolve(ROOT, '.github', 'workflows', name), 'utf8');
  return yaml.load(content);
}

const planWorkflow = loadWorkflow('terraform-plan.yml');
const applyWorkflow = loadWorkflow('terraform-apply.yml');
const destroyWorkflow = loadWorkflow('terraform-destroy.yml');

// ---------------------------------------------------------------------------
// Terraform Plan Workflow
// ---------------------------------------------------------------------------
describe('terraform-plan.yml', () => {
  // Validates: Requirement 12.1 — triggers on pull_request targeting main
  // Validates: Requirement 12.2 — triggers on push to main
  it('triggers on pull_request and push to main', () => {
    const triggers = planWorkflow.on;
    expect(triggers.pull_request).toBeDefined();
    expect(triggers.pull_request.branches).toContain('main');
    expect(triggers.push).toBeDefined();
    expect(triggers.push.branches).toContain('main');
  });

  // Validates: Requirement 1.1 — OIDC authentication via id-token: write
  it('has id-token: write permission', () => {
    const perms = planWorkflow.permissions;
    expect(perms['id-token']).toBe('write');
  });

  // Validates: Requirement 5.1 — validate and fmt-check steps
  it('has terraform validate and fmt-check steps in correct order', () => {
    const steps: any[] = planWorkflow.jobs.plan.steps;
    const names = steps.map((s: any) => s.name);

    const initIdx = names.findIndex((n: string) => /terraform init/i.test(n));
    const validateIdx = names.findIndex((n: string) => /terraform validate/i.test(n));
    const fmtIdx = names.findIndex((n: string) => /terraform fmt/i.test(n) || /format check/i.test(n));
    const planIdx = names.findIndex((n: string) => /terraform plan/i.test(n));

    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(validateIdx).toBeGreaterThan(initIdx);
    expect(fmtIdx).toBeGreaterThan(initIdx);
    expect(planIdx).toBeGreaterThan(validateIdx);
  });

  // Validates: Requirement 5.2 — plan artifact upload
  it('uploads plan as artifact', () => {
    const steps: any[] = planWorkflow.jobs.plan.steps;
    const uploadStep = steps.find(
      (s: any) => s.uses && s.uses.startsWith('actions/upload-artifact')
    );
    expect(uploadStep).toBeDefined();
    expect(uploadStep.with['retention-days']).toBe(7);
  });

  // Validates: Requirement 5.3 — PR comment step
  it('posts plan summary as PR comment', () => {
    const steps: any[] = planWorkflow.jobs.plan.steps;
    const commentStep = steps.find(
      (s: any) => s.uses && s.uses.startsWith('actions/github-script')
    );
    expect(commentStep).toBeDefined();
    expect(commentStep.if).toMatch(/pull_request/);
  });

  // Validates: Requirement 1.2 — OIDC auth step uses configure-aws-credentials
  it('has OIDC auth step before terraform steps', () => {
    const steps: any[] = planWorkflow.jobs.plan.steps;
    const names = steps.map((s: any) => s.name);
    const oidcIdx = steps.findIndex(
      (s: any) => s.uses && s.uses.includes('configure-aws-credentials')
    );
    const initIdx = names.findIndex((n: string) => /terraform init/i.test(n));
    expect(oidcIdx).toBeGreaterThanOrEqual(0);
    expect(oidcIdx).toBeLessThan(initIdx);
  });
});

// ---------------------------------------------------------------------------
// Terraform Apply Workflow
// ---------------------------------------------------------------------------
describe('terraform-apply.yml', () => {
  // Validates: Requirement 12.2 — triggers on push to main
  it('triggers on push to main only', () => {
    const triggers = applyWorkflow.on;
    expect(triggers.push).toBeDefined();
    expect(triggers.push.branches).toContain('main');
    expect(triggers.pull_request).toBeUndefined();
  });

  // Validates: Requirement 1.1 — OIDC id-token: write on plan job
  it('has id-token: write permission on plan job', () => {
    const perms = applyWorkflow.jobs.plan.permissions;
    expect(perms['id-token']).toBe('write');
  });

  // Validates: Requirement 1.1 — OIDC id-token: write on apply job
  it('has id-token: write permission on apply job', () => {
    const perms = applyWorkflow.jobs.apply.permissions;
    expect(perms['id-token']).toBe('write');
  });

  // Validates: Requirement 6.2 — manual approval gate via environment
  it('apply job references production environment for approval gate', () => {
    expect(applyWorkflow.jobs.apply.environment).toBe('production');
  });

  it('has correct step ordering: init → plan → apply → outputs → ansible', () => {
    const steps: any[] = applyWorkflow.jobs.apply.steps;
    const names = steps.map((s: any) => s.name);

    const initIdx = names.findIndex((n: string) => /terraform init/i.test(n));
    const planIdx = names.findIndex((n: string) => /terraform plan/i.test(n));
    const applyIdx = names.findIndex((n: string) => /terraform apply/i.test(n));
    const outputsIdx = names.findIndex((n: string) => /export.*output/i.test(n) || /terraform output/i.test(n));
    const ansibleIdx = names.findIndex((n: string) => /ansible/i.test(n));

    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThan(initIdx);
    expect(applyIdx).toBeGreaterThan(planIdx);
    expect(outputsIdx).toBeGreaterThan(applyIdx);
    expect(ansibleIdx).toBeGreaterThan(outputsIdx);
  });

  // Validates: Requirement 1.2 — OIDC auth before terraform in apply job
  it('has OIDC auth step before terraform steps in apply job', () => {
    const steps: any[] = applyWorkflow.jobs.apply.steps;
    const names = steps.map((s: any) => s.name);
    const oidcIdx = steps.findIndex(
      (s: any) => s.uses && s.uses.includes('configure-aws-credentials')
    );
    const initIdx = names.findIndex((n: string) => /terraform init/i.test(n));
    expect(oidcIdx).toBeGreaterThanOrEqual(0);
    expect(oidcIdx).toBeLessThan(initIdx);
  });
});

// ---------------------------------------------------------------------------
// Terraform Destroy Workflow
// ---------------------------------------------------------------------------
describe('terraform-destroy.yml', () => {
  // Validates: Requirement 12.3 — triggers on workflow_dispatch
  it('triggers on workflow_dispatch only', () => {
    const triggers = destroyWorkflow.on;
    expect(triggers.workflow_dispatch).toBeDefined();
    expect(triggers.push).toBeUndefined();
    expect(triggers.pull_request).toBeUndefined();
  });

  // Validates: Requirement 1.1 — OIDC id-token: write
  it('has id-token: write permission', () => {
    const perms = destroyWorkflow.jobs.destroy.permissions;
    expect(perms['id-token']).toBe('write');
  });

  // Validates: Requirement 7.2 — manual approval gate via environment
  it('references production environment for approval gate', () => {
    expect(destroyWorkflow.jobs.destroy.environment).toBe('production');
  });

  it('has correct step ordering: init → destroy', () => {
    const steps: any[] = destroyWorkflow.jobs.destroy.steps;
    const names = steps.map((s: any) => s.name);

    const initIdx = names.findIndex((n: string) => /terraform init/i.test(n));
    const destroyIdx = names.findIndex((n: string) => /terraform destroy/i.test(n));

    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(destroyIdx).toBeGreaterThan(initIdx);
  });

  // Validates: Requirement 1.2 — OIDC auth before terraform
  it('has OIDC auth step before terraform steps', () => {
    const steps: any[] = destroyWorkflow.jobs.destroy.steps;
    const names = steps.map((s: any) => s.name);
    const oidcIdx = steps.findIndex(
      (s: any) => s.uses && s.uses.includes('configure-aws-credentials')
    );
    const initIdx = names.findIndex((n: string) => /terraform init/i.test(n));
    expect(oidcIdx).toBeGreaterThanOrEqual(0);
    expect(oidcIdx).toBeLessThan(initIdx);
  });
});
