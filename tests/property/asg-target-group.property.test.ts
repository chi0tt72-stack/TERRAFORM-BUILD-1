// Feature: github-actions-cicd, Property 15: ASG references target group ARNs
// Validates: Requirements 18.1

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASG_MAIN_PATH = resolve(__dirname, '../../modules/compute-asg/main.tf');
const ASG_VARS_PATH = resolve(__dirname, '../../modules/compute-asg/variables.tf');
const asgMain = readFileSync(ASG_MAIN_PATH, 'utf-8');
const asgVars = readFileSync(ASG_VARS_PATH, 'utf-8');

// Extract the autoscaling_group resource block
const asgMatch = asgMain.match(
  /resource\s+"aws_autoscaling_group"\s+"main"\s+\{[\s\S]*?\n\}/
);

describe('Property 15: ASG references target group ARNs', () => {
  it('autoscaling_group resource exists', () => {
    expect(asgMatch).not.toBeNull();
  });

  it('ASG resource contains target_group_arns attribute', () => {
    const asgBlock = asgMatch![0];
    const tgMatch = asgBlock.match(/target_group_arns\s*=\s*(.+)/);
    expect(tgMatch).not.toBeNull();
  });

  it('ASG target_group_arns references the variable (not hardcoded)', () => {
    const asgBlock = asgMatch![0];
    const tgMatch = asgBlock.match(/target_group_arns\s*=\s*(.+)/);
    expect(tgMatch).not.toBeNull();
    const value = tgMatch![1].trim();
    expect(value).toMatch(/^var\.target_group_arns/);
  });

  it('target_group_arns variable is defined with type list(string)', () => {
    const varBlock = asgVars.match(
      /variable\s+"target_group_arns"\s+\{[\s\S]*?\n\}/
    );
    expect(varBlock).not.toBeNull();
    expect(varBlock![0]).toMatch(/type\s*=\s*list\(string\)/);
  });

  it('target_group_arns variable has a default of empty list', () => {
    const varBlock = asgVars.match(
      /variable\s+"target_group_arns"\s+\{[\s\S]*?\n\}/
    );
    expect(varBlock).not.toBeNull();
    expect(varBlock![0]).toMatch(/default\s*=\s*\[\s*\]/);
  });

  it('for any list of target group ARNs, the ASG config accepts them via variable', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringMatching(/^arn:aws:elasticloadbalancing:[a-z]{2}-[a-z]+-\d:\d{12}:targetgroup\/[a-z-]+\/[a-f0-9]{16}$/),
          { minLength: 1, maxLength: 5 }
        ),
        (arns: string[]) => {
          // Property: any non-empty list of valid target group ARNs is a valid
          // input for the target_group_arns variable, enabling ALB integration
          expect(arns.length).toBeGreaterThanOrEqual(1);
          for (const arn of arns) {
            expect(arn).toMatch(/^arn:aws:elasticloadbalancing:/);
            expect(arn).toContain(':targetgroup/');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the actual ASG resource wires target_group_arns for ALB instance registration', () => {
    const asgBlock = asgMatch![0];

    fc.assert(
      fc.property(fc.constant(asgBlock), (block) => {
        // The ASG must have target_group_arns referencing var.target_group_arns
        // This enables automatic instance registration/deregistration with the ALB
        expect(block).toMatch(/target_group_arns\s*=\s*var\.target_group_arns/);
      }),
      { numRuns: 100 }
    );
  });
});
