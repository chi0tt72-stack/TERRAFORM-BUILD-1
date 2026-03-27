// Feature: github-actions-cicd, Property 8: Path filters on all workflow triggers
// Validates: Requirements 12.4

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = resolve(__dirname, '../../.github/workflows');

const REQUIRED_PATHS = ['environments/**', 'modules/**', 'ansible/**'];
const EXEMPT_TRIGGERS = ['workflow_dispatch', 'schedule'];

// Load and parse all workflow YAML files
const workflowFiles = readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({
    name: f,
    parsed: yaml.load(readFileSync(resolve(WORKFLOWS_DIR, f), 'utf-8')) as Record<string, any>,
  }));

/**
 * Extracts the paths filter array from a trigger config.
 * Handles both shorthand (`push: { branches, paths }`) and
 * expanded forms.
 */
function getPathsFromTrigger(triggerConfig: any): string[] {
  if (!triggerConfig || typeof triggerConfig !== 'object') return [];
  return Array.isArray(triggerConfig.paths) ? triggerConfig.paths : [];
}

describe('Property 8: Path filters on all workflow triggers', () => {
  it('at least one workflow file exists', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  it('every non-exempt trigger includes all required path filters', () => {
    for (const wf of workflowFiles) {
      const triggers = wf.parsed?.on ?? wf.parsed?.true ?? {};
      const triggerEntries =
        typeof triggers === 'string'
          ? [[triggers, {}]]
          : Object.entries(triggers);

      for (const [triggerName, triggerConfig] of triggerEntries as [string, any][]) {
        if (EXEMPT_TRIGGERS.includes(triggerName)) continue;

        const paths = getPathsFromTrigger(triggerConfig);

        for (const requiredPath of REQUIRED_PATHS) {
          expect(
            paths.includes(requiredPath),
            `${wf.name} → trigger "${triggerName}" is missing required path filter "${requiredPath}". Found: [${paths.join(', ')}]`
          ).toBe(true);
        }
      }
    }
  });

  it('for any required path pattern, every non-exempt trigger includes it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: workflowFiles.length - 1 }),
        fc.integer({ min: 0, max: REQUIRED_PATHS.length - 1 }),
        (wfIdx: number, pathIdx: number) => {
          const wf = workflowFiles[wfIdx];
          const requiredPath = REQUIRED_PATHS[pathIdx];
          const triggers = wf.parsed?.on ?? wf.parsed?.true ?? {};
          const triggerEntries =
            typeof triggers === 'string'
              ? [[triggers, {}]]
              : Object.entries(triggers);

          for (const [triggerName, triggerConfig] of triggerEntries as [string, any][]) {
            if (EXEMPT_TRIGGERS.includes(triggerName)) continue;

            const paths = getPathsFromTrigger(triggerConfig);
            expect(
              paths.includes(requiredPath),
              `${wf.name} → trigger "${triggerName}" must include path filter "${requiredPath}"`
            ).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('workflow_dispatch triggers do not require path filters', () => {
    for (const wf of workflowFiles) {
      const triggers = wf.parsed?.on ?? wf.parsed?.true ?? {};
      if (typeof triggers !== 'object') continue;

      if ('workflow_dispatch' in triggers) {
        // workflow_dispatch is exempt — just confirm it exists without error
        expect(triggers.workflow_dispatch).toBeDefined();
      }
    }
  });
});
