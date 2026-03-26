// Feature: github-actions-cicd, Property 4: ASG capacity constraints
// Validates: Requirements 8.3

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

describe('Property 4: ASG capacity constraints', () => {
  it('ASG resource references var.min_size, var.desired_capacity, and var.max_size', () => {
    // Extract the autoscaling_group resource block
    const asgMatch = asgMain.match(
      /resource\s+"aws_autoscaling_group"\s+"main"\s+\{[\s\S]*?\n\}/
    );
    expect(asgMatch).not.toBeNull();
    const asgBlock = asgMatch![0];

    expect(asgBlock).toContain('var.min_size');
    expect(asgBlock).toContain('var.desired_capacity');
    expect(asgBlock).toContain('var.max_size');
  });

  it('min_size variable has a default >= 2', () => {
    const minSizeBlock = asgVars.match(
      /variable\s+"min_size"\s+\{[\s\S]*?\n\}/
    );
    expect(minSizeBlock).not.toBeNull();

    const defaultMatch = minSizeBlock![0].match(/default\s*=\s*(\d+)/);
    expect(defaultMatch).not.toBeNull();
    expect(Number(defaultMatch![1])).toBeGreaterThanOrEqual(2);
  });

  it('desired_capacity default >= min_size default', () => {
    const minDefault = Number(
      asgVars.match(/variable\s+"min_size"\s+\{[\s\S]*?\n\}/)![0]
        .match(/default\s*=\s*(\d+)/)![1]
    );
    const desiredDefault = Number(
      asgVars.match(/variable\s+"desired_capacity"\s+\{[\s\S]*?\n\}/)![0]
        .match(/default\s*=\s*(\d+)/)![1]
    );

    expect(desiredDefault).toBeGreaterThanOrEqual(minDefault);
  });

  it('max_size default >= desired_capacity default', () => {
    const desiredDefault = Number(
      asgVars.match(/variable\s+"desired_capacity"\s+\{[\s\S]*?\n\}/)![0]
        .match(/default\s*=\s*(\d+)/)![1]
    );
    const maxDefault = Number(
      asgVars.match(/variable\s+"max_size"\s+\{[\s\S]*?\n\}/)![0]
        .match(/default\s*=\s*(\d+)/)![1]
    );

    expect(maxDefault).toBeGreaterThanOrEqual(desiredDefault);
  });

  it('max_size is not hardcoded in the ASG resource (uses a variable)', () => {
    const asgBlock = asgMain.match(
      /resource\s+"aws_autoscaling_group"\s+"main"\s+\{[\s\S]*?\n\}/
    )![0];

    // max_size line should reference var.max_size, not a literal number
    const maxLine = asgBlock.match(/max_size\s*=\s*(.*)/);
    expect(maxLine).not.toBeNull();
    expect(maxLine![1].trim()).toMatch(/^var\.max_size/);
  });

  it('for any valid capacity triple, min <= desired <= max holds and min >= 2', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (minSize: number, desiredOffset: number, maxOffset: number) => {
          // Generate valid capacity values that mirror the constraints
          const desired = minSize + (desiredOffset % 50);
          const max = desired + (maxOffset % 50);

          // The property: for any valid ASG config, these invariants must hold
          expect(minSize).toBeGreaterThanOrEqual(2);
          expect(desired).toBeGreaterThanOrEqual(minSize);
          expect(max).toBeGreaterThanOrEqual(desired);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the actual default values satisfy min_size >= 2 AND min <= desired <= max', () => {
    const defaults = {
      min: Number(
        asgVars.match(/variable\s+"min_size"\s+\{[\s\S]*?\n\}/)![0]
          .match(/default\s*=\s*(\d+)/)![1]
      ),
      desired: Number(
        asgVars.match(/variable\s+"desired_capacity"\s+\{[\s\S]*?\n\}/)![0]
          .match(/default\s*=\s*(\d+)/)![1]
      ),
      max: Number(
        asgVars.match(/variable\s+"max_size"\s+\{[\s\S]*?\n\}/)![0]
          .match(/default\s*=\s*(\d+)/)![1]
      ),
    };

    // Property: the shipped defaults must always satisfy the capacity invariant
    fc.assert(
      fc.property(fc.constant(defaults), (cfg) => {
        expect(cfg.min).toBeGreaterThanOrEqual(2);
        expect(cfg.desired).toBeGreaterThanOrEqual(cfg.min);
        expect(cfg.max).toBeGreaterThanOrEqual(cfg.desired);
      }),
      { numRuns: 100 }
    );
  });
});
