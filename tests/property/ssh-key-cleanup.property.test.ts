// Feature: github-actions-cicd, Property 7: SSH key cleanup on all exit paths
// Validates: Requirements 11.4

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = resolve(__dirname, '../../.github/workflows');

// Load and parse all workflow YAML files
const workflowFiles = readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({
    name: f,
    content: readFileSync(resolve(WORKFLOWS_DIR, f), 'utf-8'),
    parsed: yaml.load(readFileSync(resolve(WORKFLOWS_DIR, f), 'utf-8')) as Record<string, any>,
  }));

/**
 * Checks whether a step writes an SSH private key to a temporary file.
 * Looks for patterns like: > /tmp/ssh_key, > /tmp/some_key, etc.
 */
function stepWritesSshKeyToFile(step: Record<string, any>): boolean {
  if (!step.run || typeof step.run !== 'string') return false;
  // Match writing to a temp file path that looks like an SSH key
  return />\s*\/tmp\/ssh_key/.test(step.run);
}

/**
 * Checks whether a step cleans up (deletes) the SSH key temp file
 * and has `if: always()` to ensure it runs on all exit paths.
 */
function stepCleansUpSshKey(step: Record<string, any>): boolean {
  if (!step.run || typeof step.run !== 'string') return false;
  const deletesKey = /rm\s+(-f\s+)?\/tmp\/ssh_key/.test(step.run);
  const alwaysRuns =
    step.if === 'always()' || step.if === '${{ always() }}';
  return deletesKey && alwaysRuns;
}

describe('Property 7: SSH key cleanup on all exit paths', () => {
  it('at least one workflow writes an SSH key to a temp file', () => {
    const hasKeyWrite = workflowFiles.some((wf) => {
      const jobs = wf.parsed?.jobs ?? {};
      return Object.values(jobs).some((job: any) =>
        (job.steps ?? []).some(stepWritesSshKeyToFile)
      );
    });
    expect(hasKeyWrite).toBe(true);
  });

  it('every job that writes an SSH key has a subsequent cleanup step with if: always()', () => {
    for (const wf of workflowFiles) {
      const jobs = wf.parsed?.jobs ?? {};
      for (const [jobName, job] of Object.entries(jobs) as [string, any][]) {
        const steps: Record<string, any>[] = job.steps ?? [];
        const writeIndices = steps
          .map((s, i) => (stepWritesSshKeyToFile(s) ? i : -1))
          .filter((i) => i >= 0);

        for (const writeIdx of writeIndices) {
          // There must be a cleanup step AFTER the write step
          const hasCleanup = steps
            .slice(writeIdx + 1)
            .some(stepCleansUpSshKey);

          expect(
            hasCleanup,
            `${wf.name} → job "${jobName}": step ${writeIdx + 1} writes SSH key to /tmp/ssh_key but no subsequent cleanup step with "if: always()" was found`
          ).toBe(true);
        }
      }
    }
  });

  it('for any generated temp file path suffix, a job writing to /tmp/ssh_key always cleans up', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary workflow file indices to pick from
        fc.integer({ min: 0, max: workflowFiles.length - 1 }),
        (wfIdx: number) => {
          const wf = workflowFiles[wfIdx];
          const jobs = wf.parsed?.jobs ?? {};

          for (const [jobName, job] of Object.entries(jobs) as [string, any][]) {
            const steps: Record<string, any>[] = job.steps ?? [];
            const writesKey = steps.some(stepWritesSshKeyToFile);

            if (writesKey) {
              const hasCleanup = steps.some(stepCleansUpSshKey);
              expect(
                hasCleanup,
                `${wf.name} → job "${jobName}": writes SSH key but missing cleanup with if: always()`
              ).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cleanup step is the last or near-last step in each job that writes SSH keys', () => {
    for (const wf of workflowFiles) {
      const jobs = wf.parsed?.jobs ?? {};
      for (const [jobName, job] of Object.entries(jobs) as [string, any][]) {
        const steps: Record<string, any>[] = job.steps ?? [];
        const writesKey = steps.some(stepWritesSshKeyToFile);

        if (writesKey) {
          const cleanupIdx = steps.findIndex(stepCleansUpSshKey);
          expect(
            cleanupIdx,
            `${wf.name} → job "${jobName}": no cleanup step found`
          ).toBeGreaterThan(-1);

          // Cleanup should be the last step in the job
          expect(
            cleanupIdx,
            `${wf.name} → job "${jobName}": cleanup step should be the last step (index ${cleanupIdx} vs last ${steps.length - 1})`
          ).toBe(steps.length - 1);
        }
      }
    }
  });
});
