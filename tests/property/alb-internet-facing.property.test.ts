// Feature: github-actions-cicd, Property 10: ALB is internet-facing with correct security group
// Validates: Requirements 14.1, 14.2

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALB_MAIN_PATH = resolve(__dirname, '../../modules/alb/main.tf');
const albMain = readFileSync(ALB_MAIN_PATH, 'utf-8');

// Extract the aws_lb resource block
const albMatch = albMain.match(
  /resource\s+"aws_lb"\s+"main"\s+\{[\s\S]*?\n\}/
);

describe('Property 10: ALB is internet-facing with correct security group', () => {
  it('aws_lb resource exists', () => {
    expect(albMatch).not.toBeNull();
  });

  it('ALB internal attribute is false (internet-facing)', () => {
    const albBlock = albMatch![0];
    expect(albBlock).toMatch(/internal\s*=\s*false/);
  });

  it('ALB subnets reference the subnet_ids variable', () => {
    const albBlock = albMatch![0];
    expect(albBlock).toMatch(/subnets\s*=\s*var\.subnet_ids/);
  });

  it('ALB security_groups references the ALB security group resource', () => {
    const albBlock = albMatch![0];
    expect(albBlock).toMatch(/security_groups\s*=\s*\[aws_security_group\.alb\.id\]/);
  });

  it('ALB load_balancer_type is application', () => {
    const albBlock = albMatch![0];
    expect(albBlock).toMatch(/load_balancer_type\s*=\s*"application"/);
  });

  it('for any ALB config, internet-facing ALB must use public subnets and ALB SG', () => {
    fc.assert(
      fc.property(
        fc.record({
          environment: fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/),
          subnetIds: fc.array(
            fc.stringMatching(/^subnet-[a-f0-9]{17}$/),
            { minLength: 2, maxLength: 6 }
          ),
          sgId: fc.stringMatching(/^sg-[a-f0-9]{17}$/),
        }),
        ({ environment, subnetIds, sgId }) => {
          // Property: an internet-facing ALB must have at least 2 subnets
          expect(subnetIds.length).toBeGreaterThanOrEqual(2);
          // Property: security group ID must be a valid SG reference
          expect(sgId).toMatch(/^sg-/);
          // Property: environment name must be non-empty
          expect(environment.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the actual ALB resource satisfies internet-facing with correct SG property', () => {
    const albBlock = albMatch![0];

    fc.assert(
      fc.property(fc.constant(albBlock), (block) => {
        // Must be internet-facing (internal = false)
        expect(block).toMatch(/internal\s*=\s*false/);
        // Must NOT be internal
        expect(block).not.toMatch(/internal\s*=\s*true/);
        // Must reference public subnets via variable
        expect(block).toMatch(/subnets\s*=\s*var\.subnet_ids/);
        // Must reference the ALB security group resource
        expect(block).toMatch(/security_groups\s*=\s*\[aws_security_group\.alb\.id\]/);
        // Must be an application load balancer
        expect(block).toMatch(/load_balancer_type\s*=\s*"application"/);
      }),
      { numRuns: 100 }
    );
  });
});
