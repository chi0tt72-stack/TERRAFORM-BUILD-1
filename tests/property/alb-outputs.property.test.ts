// Feature: github-actions-cicd, Property 11: ALB module outputs completeness
// Validates: Requirements 14.5, 18.4, 19.3

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALB_OUTPUTS_PATH = resolve(__dirname, '../../modules/alb/outputs.tf');
const outputsContent = readFileSync(ALB_OUTPUTS_PATH, 'utf-8');

const REQUIRED_OUTPUTS = [
  'alb_dns_name',
  'alb_arn',
  'alb_security_group_id',
  'target_group_arn',
] as const;

// Extract all output block names from the file
const outputNames = [...outputsContent.matchAll(/output\s+"([^"]+)"/g)].map(
  (m) => m[1]
);

describe('Property 11: ALB module outputs completeness', () => {
  it('outputs file contains all four required outputs', () => {
    for (const name of REQUIRED_OUTPUTS) {
      expect(outputNames).toContain(name);
    }
  });

  it('each required output has a value expression', () => {
    for (const name of REQUIRED_OUTPUTS) {
      const blockRegex = new RegExp(
        `output\\s+"${name}"\\s*\\{[\\s\\S]*?value\\s*=[\\s\\S]*?\\}`,
      );
      expect(outputsContent).toMatch(blockRegex);
    }
  });

  it('alb_dns_name references aws_lb.main.dns_name', () => {
    const block = outputsContent.match(
      /output\s+"alb_dns_name"\s*\{[\s\S]*?\n\}/
    )![0];
    expect(block).toMatch(/value\s*=\s*aws_lb\.main\.dns_name/);
  });

  it('alb_arn references aws_lb.main.arn', () => {
    const block = outputsContent.match(
      /output\s+"alb_arn"\s*\{[\s\S]*?\n\}/
    )![0];
    expect(block).toMatch(/value\s*=\s*aws_lb\.main\.arn/);
  });

  it('alb_security_group_id references aws_security_group.alb.id', () => {
    const block = outputsContent.match(
      /output\s+"alb_security_group_id"\s*\{[\s\S]*?\n\}/
    )![0];
    expect(block).toMatch(/value\s*=\s*aws_security_group\.alb\.id/);
  });

  it('target_group_arn references aws_lb_target_group.main.arn', () => {
    const block = outputsContent.match(
      /output\s+"target_group_arn"\s*\{[\s\S]*?\n\}/
    )![0];
    expect(block).toMatch(/value\s*=\s*aws_lb_target_group\.main\.arn/);
  });

  it('for any subset of required output names, the outputs file contains all of them', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...REQUIRED_OUTPUTS], {
          minLength: REQUIRED_OUTPUTS.length,
          maxLength: REQUIRED_OUTPUTS.length,
        }),
        (requiredSet) => {
          for (const name of requiredSet) {
            expect(outputNames).toContain(name);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any required output name, the outputs file has a matching output block with a value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REQUIRED_OUTPUTS),
        (name) => {
          const blockRegex = new RegExp(
            `output\\s+"${name}"\\s*\\{[\\s\\S]*?value\\s*=[\\s\\S]*?\\}`
          );
          expect(outputsContent).toMatch(blockRegex);
        }
      ),
      { numRuns: 100 }
    );
  });
});
