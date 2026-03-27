// Feature: github-actions-cicd, Property 1: Zero secrets in GitHub workflow files
// Validates: Requirements 1.5, 3.4, 13.1, 13.5

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

describe('Property 1: Zero secrets in GitHub workflow files', () => {
  it('at least one workflow file exists', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  it('no workflow file contains a reference to secrets.* context', () => {
    // The pattern matches GitHub Actions secrets context usage:
    // ${{ secrets.SOMETHING }} or secrets.SOMETHING in expressions
    const secretsPattern = /\bsecrets\.\w+/;

    for (const wf of workflowFiles) {
      for (let i = 0; i < wf.lines.length; i++) {
        const line = wf.lines[i];
        expect(
          secretsPattern.test(line),
          `${wf.name}:${i + 1} contains a secrets.* reference: "${line.trim()}"`
        ).toBe(false);
      }
    }
  });

  it('for any generated secret name, no workflow file contains secrets.<name>', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][A-Z0-9_]{1,29}$/),
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

  it('all sensitive value references use vars.* context or hardcoded non-sensitive identifiers', () => {
    // Verify that AWS_ROLE_ARN, AWS_REGION, and secret name references
    // use vars.* context (not secrets.*)
    const varsPattern = /\bvars\.\w+/g;
    const secretsPattern = /\bsecrets\.\w+/g;

    for (const wf of workflowFiles) {
      const secretsMatches = wf.content.match(secretsPattern) ?? [];
      expect(
        secretsMatches,
        `${wf.name} must have zero secrets.* references, found: ${secretsMatches.join(', ')}`
      ).toHaveLength(0);

      // Confirm vars.* references exist (pipeline config uses vars, not secrets)
      const varsMatches = wf.content.match(varsPattern) ?? [];
      expect(
        varsMatches.length,
        `${wf.name} should use vars.* for configuration values`
      ).toBeGreaterThan(0);
    }
  });
});
