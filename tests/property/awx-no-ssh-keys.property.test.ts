// Feature: awx-integration, Property 2: Pipeline does not handle SSH private keys for Ansible execution
// Validates: Requirements 6.5, 12.3

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY_WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/terraform-apply.yml');
const workflowContent = readFileSync(APPLY_WORKFLOW_PATH, 'utf-8');
const workflow = yaml.load(workflowContent) as Record<string, any>;

// Extract the apply job steps
const applyJob = workflow?.jobs?.apply;
const applySteps: Record<string, any>[] = applyJob?.steps ?? [];

/**
 * Checks whether a step retrieves an SSH private key for Ansible execution.
 * Looks for patterns like: ssh-private-key, SSH_PRIVATE_KEY retrieval from
 * Secrets Manager that writes to a temp file for Ansible use.
 */
function stepRetrievesSshPrivateKey(step: Record<string, any>): boolean {
  if (!step.run || typeof step.run !== 'string') return false;
  const run = step.run.toLowerCase();
  // Check for SSH private key retrieval from Secrets Manager
  const retrievesPrivateKey =
    /ssh.private.key/.test(run) &&
    /secretsmanager/.test(run) &&
    /get-secret-value/.test(run);
  return retrievesPrivateKey;
}

describe('Property 2: Pipeline does not handle SSH private keys for Ansible execution', () => {
  it('the apply job exists in terraform-apply.yml', () => {
    expect(applyJob).toBeDefined();
    expect(applySteps.length).toBeGreaterThan(0);
  });

  it('the plan job still retrieves SSH private key (for Terraform key pair)', () => {
    const planJob = workflow?.jobs?.plan;
    const planSteps: Record<string, any>[] = planJob?.steps ?? [];
    const hasPrivateKeyStep = planSteps.some(stepRetrievesSshPrivateKey);
    expect(hasPrivateKeyStep).toBe(true);
  });

  it('no apply job step retrieves SSH private key for Ansible execution', () => {
    for (const step of applySteps) {
      expect(
        stepRetrievesSshPrivateKey(step),
        `Apply job step "${step.name ?? 'unnamed'}" retrieves SSH private key — this should be handled by AWX, not the pipeline`
      ).toBe(false);
    }
  });

  it('for any apply step index, that step does not retrieve SSH private keys', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Math.max(applySteps.length - 1, 0) }),
        (stepIdx: number) => {
          const step = applySteps[stepIdx];
          if (!step) return;

          expect(
            stepRetrievesSshPrivateKey(step),
            `Apply job step ${stepIdx} ("${step.name ?? 'unnamed'}") retrieves SSH private key`
          ).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('apply job step names do not reference SSH private key retrieval', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Math.max(applySteps.length - 1, 0) }),
        (stepIdx: number) => {
          const step = applySteps[stepIdx];
          if (!step) return;

          const name = (step.name ?? '').toLowerCase();
          // Step names should not indicate SSH private key retrieval
          const indicatesPrivateKeyRetrieval =
            name.includes('ssh') &&
            name.includes('private') &&
            !name.includes('public');

          expect(
            indicatesPrivateKeyRetrieval,
            `Apply job step ${stepIdx} name "${step.name}" suggests SSH private key handling`
          ).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
