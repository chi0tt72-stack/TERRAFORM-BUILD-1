import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..', '..');

function loadWorkflow(name: string): any {
  const content = readFileSync(resolve(ROOT, '.github', 'workflows', name), 'utf8');
  return yaml.load(content);
}

const applyWorkflow = loadWorkflow('terraform-apply.yml');
const applySteps: any[] = applyWorkflow.jobs.apply.steps;
const applyStepNames: string[] = applySteps.map((s: any) => s.name);

// ---------------------------------------------------------------------------
// AWX Workflow Changes — terraform-apply.yml apply job
// ---------------------------------------------------------------------------
describe('terraform-apply.yml AWX workflow changes', () => {
  // Validates: Requirement 12.1 — "Generate Ansible inventory from ASG" step removed
  it('does not contain "Generate Ansible inventory from ASG" step', () => {
    const match = applyStepNames.find((n) => /generate ansible inventory/i.test(n));
    expect(match).toBeUndefined();
  });

  // Validates: Requirement 12.2 — "Run Ansible Playbook" step removed
  it('does not contain "Run Ansible Playbook" step', () => {
    const match = applyStepNames.find((n) => /run ansible playbook/i.test(n));
    expect(match).toBeUndefined();
  });

  // Validates: Requirement 12.4 — SSH public key retrieval retained
  it('retains SSH public key retrieval in the apply job', () => {
    const match = applyStepNames.find((n) => /ssh public key/i.test(n));
    expect(match).toBeDefined();
  });

  // Validates: Requirement 11.1 — health check exists before job launch
  it('has health check step before job launch step', () => {
    const healthIdx = applyStepNames.findIndex((n) => /wait for awx health/i.test(n));
    const launchIdx = applyStepNames.findIndex((n) => /launch awx job/i.test(n));

    expect(healthIdx).toBeGreaterThanOrEqual(0);
    expect(launchIdx).toBeGreaterThanOrEqual(0);
    expect(healthIdx).toBeLessThan(launchIdx);
  });

  // Validates: Requirements 11.1, 12.1, 12.2, 12.4
  // AWX steps in correct order: health check → inventory update → job launch → poll
  it('has AWX steps in correct order: health check → inventory update → job launch → poll', () => {
    const healthIdx = applyStepNames.findIndex((n) => /wait for awx health/i.test(n));
    const inventoryIdx = applyStepNames.findIndex((n) => /update awx inventory/i.test(n));
    const launchIdx = applyStepNames.findIndex((n) => /launch awx job/i.test(n));
    const pollIdx = applyStepNames.findIndex((n) => /poll awx job/i.test(n));

    expect(healthIdx).toBeGreaterThanOrEqual(0);
    expect(inventoryIdx).toBeGreaterThan(healthIdx);
    expect(launchIdx).toBeGreaterThan(inventoryIdx);
    expect(pollIdx).toBeGreaterThan(launchIdx);
  });
});
