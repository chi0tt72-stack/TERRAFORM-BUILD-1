// Feature: github-actions-cicd, Property 3: IAM permissions policy service completeness
// **Validates: Requirements 2.3, 3.6**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const REQUIRED_SERVICE_PREFIXES = [
  'ec2',
  'autoscaling',
  's3',
  'cloudwatch',
  'sns',
  'iam',
  'secretsmanager',
  'kms',
] as const;

function loadPermissionsPolicy(): { Version: string; Statement: Array<{ Effect: string; Action: string[]; Resource: string }> } {
  const policyPath = resolve(__dirname, '../../iam-policies/github-terraform-permissions.json');
  return JSON.parse(readFileSync(policyPath, 'utf-8'));
}

function getActionsFromPolicy(policy: ReturnType<typeof loadPermissionsPolicy>): string[] {
  return policy.Statement.flatMap((stmt) => stmt.Action);
}

function servicePrefixCoveredByActions(prefix: string, actions: string[]): boolean {
  return actions.some((action) => action.toLowerCase().startsWith(`${prefix}:`));
}

describe('Property 3: IAM permissions policy service completeness', () => {
  const policy = loadPermissionsPolicy();
  const allActions = getActionsFromPolicy(policy);

  it('every required service prefix has at least one matching action in the policy', () => {
    // Generate random non-empty subsets of the required service prefixes
    // and verify the actual policy covers each service in the subset.
    fc.assert(
      fc.property(
        fc.subarray([...REQUIRED_SERVICE_PREFIXES], { minLength: 1 }),
        (serviceSubset) => {
          for (const prefix of serviceSubset) {
            expect(
              servicePrefixCoveredByActions(prefix, allActions),
            ).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
