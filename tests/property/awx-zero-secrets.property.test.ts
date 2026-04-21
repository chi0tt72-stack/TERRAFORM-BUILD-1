// Feature: awx-integration, Property 5: Zero AWX secrets in GitHub workflow files
// Validates: Requirements 14.1, 14.2, 14.4

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = resolve(__dirname, '../../.github/workflows');

// Load all workflow YAML files
const workflowFiles = readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({
    name: f,
    content: readFileSync(resolve(WORKFLOWS_DIR, f), 'utf-8'),
    lines: readFileSync(resolve(WORKFLOWS_DIR, f), 'utf-8').split('\n'),
  }));

describe('Property 5: Zero AWX secrets in GitHub workflow files', () => {
  it('at least one workflow file exists', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  it('no workflow file contains secrets.AWX_* references', () => {
    const awxSecretsPattern = /\bsecrets\.AWX_\w+/;

    for (const wf of workflowFiles) {
      for (let i = 0; i < wf.lines.length; i++) {
        const line = wf.lines[i];
        expect(
          awxSecretsPattern.test(line),
          `${wf.name}:${i + 1} contains a secrets.AWX_* reference: "${line.trim()}"`
        ).toBe(false);
      }
    }
  });

  it('no workflow file contains secrets.*awx* references (case-insensitive)', () => {
    const awxSecretsPattern = /\bsecrets\.\w*awx\w*/i;

    for (const wf of workflowFiles) {
      for (let i = 0; i < wf.lines.length; i++) {
        const line = wf.lines[i];
        expect(
          awxSecretsPattern.test(line),
          `${wf.name}:${i + 1} contains a secrets.*awx* reference: "${line.trim()}"`
        ).toBe(false);
      }
    }
  });

  it('for any generated AWX secret name, no workflow file contains secrets.<name>', () => {
    /**
     * Validates: Requirements 14.1, 14.2
     *
     * Property: for any AWX-related secret name (AWX_ADMIN_PASSWORD, AWX_HOST,
     * AWX_TOKEN, etc.), no workflow file references it via secrets.* context.
     */
    fc.assert(
      fc.property(
        fc.constantFrom(
          'AWX_ADMIN_PASSWORD',
          'AWX_HOST',
          'AWX_TOKEN',
          'AWX_URL',
          'AWX_SECRET',
          'AWX_API_KEY',
          'AWX_CREDENTIAL',
          'AWX_SSH_KEY',
          'AWX_PRIVATE_KEY'
        ),
        (secretName: string) => {
          const pattern = new RegExp(`\\bsecrets\\.${secretName}\\b`);
          for (const wf of workflowFiles) {
            expect(
              pattern.test(wf.content),
              `${wf.name} must not reference secrets.${secretName}`
            ).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any randomly generated AWX secret name pattern, no workflow references it', () => {
    /**
     * Validates: Requirements 14.4
     *
     * Property: for any generated secret name matching AWX_*, no workflow file
     * contains a secrets.<name> reference. All AWX values must come from vars.*,
     * Terraform outputs, or hardcoded non-sensitive identifiers.
     */
    fc.assert(
      fc.property(
        fc.stringMatching(/^AWX_[A-Z][A-Z0-9_]{0,19}$/),
        (secretName: string) => {
          const pattern = new RegExp(`\\bsecrets\\.${secretName}\\b`);
          for (const wf of workflowFiles) {
            expect(
              pattern.test(wf.content),
              `${wf.name} must not reference secrets.${secretName}`
            ).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('AWX config values are sourced from vars.*, Terraform outputs, or hardcoded identifiers', () => {
    /**
     * Validates: Requirements 14.1, 14.2, 14.4
     *
     * Property: across all workflow files, any AWX-related configuration
     * (admin password secret name, job template name, AWX server IP) must be
     * sourced from vars.* context, Terraform outputs, or hardcoded non-sensitive
     * identifiers — never from secrets.* context.
     */
    const awxRelatedPatterns = [
      /awx.*admin.*password/i,
      /awx.*secret/i,
      /awx.*token/i,
      /awx.*credential/i,
      /awx.*private.*ip/i,
      /awx.*host/i,
      /site-yml/i,
    ];

    for (const wf of workflowFiles) {
      for (let i = 0; i < wf.lines.length; i++) {
        const line = wf.lines[i];
        const isAwxRelated = awxRelatedPatterns.some((p) => p.test(line));
        if (isAwxRelated) {
          // If the line is AWX-related, it must NOT use secrets.* context
          expect(
            /\bsecrets\.\w+/.test(line),
            `${wf.name}:${i + 1} AWX-related line uses secrets.* context: "${line.trim()}"`
          ).toBe(false);
        }
      }
    }
  });
});
