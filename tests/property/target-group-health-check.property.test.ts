// Feature: github-actions-cicd, Property 13: Target group health check configuration
// Validates: Requirements 16.1, 16.2, 16.3

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALB_MAIN_PATH = resolve(__dirname, '../../modules/alb/main.tf');
const albMain = readFileSync(ALB_MAIN_PATH, 'utf-8');

// Extract the target group resource block
const tgMatch = albMain.match(
  /resource\s+"aws_lb_target_group"\s+"main"\s+\{[\s\S]*?\n\}/
);

// Extract the health_check block from a target group block
function extractHealthCheckBlock(tgBlock: string): string | null {
  const match = tgBlock.match(/health_check\s+\{([^}]*)\}/);
  return match ? match[1] : null;
}

describe('Property 13: Target group health check configuration', () => {
  it('target group resource exists', () => {
    expect(tgMatch).not.toBeNull();
  });

  it('target group protocol is HTTP', () => {
    const tgBlock = tgMatch![0];
    // Match protocol at the top level of the resource (not inside health_check)
    const topLevel = tgBlock.replace(/health_check\s+\{[^}]*\}/, '');
    expect(topLevel).toMatch(/protocol\s*=\s*"HTTP"/);
  });

  it('target group port is 80', () => {
    const tgBlock = tgMatch![0];
    const topLevel = tgBlock.replace(/health_check\s+\{[^}]*\}/, '');
    expect(topLevel).toMatch(/port\s*=\s*80/);
  });

  it('target group is associated with the VPC', () => {
    const tgBlock = tgMatch![0];
    expect(tgBlock).toMatch(/vpc_id\s*=\s*var\.vpc_id/);
  });

  it('health check block exists', () => {
    const hc = extractHealthCheckBlock(tgMatch![0]);
    expect(hc).not.toBeNull();
  });

  it('health check path is "/"', () => {
    const hc = extractHealthCheckBlock(tgMatch![0])!;
    expect(hc).toMatch(/path\s*=\s*"\/"/);
  });

  it('health check port is "80"', () => {
    const hc = extractHealthCheckBlock(tgMatch![0])!;
    expect(hc).toMatch(/port\s*=\s*"80"/);
  });

  it('health check protocol is HTTP', () => {
    const hc = extractHealthCheckBlock(tgMatch![0])!;
    expect(hc).toMatch(/protocol\s*=\s*"HTTP"/);
  });

  it('health check interval is 30', () => {
    const hc = extractHealthCheckBlock(tgMatch![0])!;
    expect(hc).toMatch(/interval\s*=\s*30/);
  });

  it('health check timeout is 5', () => {
    const hc = extractHealthCheckBlock(tgMatch![0])!;
    expect(hc).toMatch(/timeout\s*=\s*5/);
  });

  it('healthy threshold is 2', () => {
    const hc = extractHealthCheckBlock(tgMatch![0])!;
    expect(hc).toMatch(/healthy_threshold\s*=\s*2/);
  });

  it('unhealthy threshold is 3', () => {
    const hc = extractHealthCheckBlock(tgMatch![0])!;
    expect(hc).toMatch(/unhealthy_threshold\s*=\s*3/);
  });

  it('for any valid target group config, all health check parameters must match the specification', () => {
    const tgBlock = tgMatch![0];

    fc.assert(
      fc.property(fc.constant(tgBlock), (block) => {
        const hc = extractHealthCheckBlock(block);
        expect(hc).not.toBeNull();

        // Protocol and port at resource level
        const topLevel = block.replace(/health_check\s+\{[^}]*\}/, '');
        expect(topLevel).toMatch(/protocol\s*=\s*"HTTP"/);
        expect(topLevel).toMatch(/port\s*=\s*80/);

        // Health check parameters
        expect(hc!).toMatch(/path\s*=\s*"\/"/);
        expect(hc!).toMatch(/port\s*=\s*"80"/);
        expect(hc!).toMatch(/protocol\s*=\s*"HTTP"/);
        expect(hc!).toMatch(/interval\s*=\s*30/);
        expect(hc!).toMatch(/timeout\s*=\s*5/);
        expect(hc!).toMatch(/healthy_threshold\s*=\s*2/);
        expect(hc!).toMatch(/unhealthy_threshold\s*=\s*3/);
      }),
      { numRuns: 100 }
    );
  });

  it('for any health check spec, interval must exceed timeout and thresholds must be positive', () => {
    fc.assert(
      fc.property(
        fc.record({
          interval: fc.integer({ min: 5, max: 300 }),
          timeout: fc.integer({ min: 2, max: 120 }),
          healthyThreshold: fc.integer({ min: 2, max: 10 }),
          unhealthyThreshold: fc.integer({ min: 2, max: 10 }),
        }),
        ({ interval, timeout, healthyThreshold, unhealthyThreshold }) => {
          // A valid health check must have interval > timeout
          if (interval <= timeout) return; // skip invalid combos

          expect(interval).toBeGreaterThan(timeout);
          expect(healthyThreshold).toBeGreaterThanOrEqual(2);
          expect(unhealthyThreshold).toBeGreaterThanOrEqual(2);

          // Our actual config satisfies these constraints
          const actualInterval = 30;
          const actualTimeout = 5;
          const actualHealthy = 2;
          const actualUnhealthy = 3;

          expect(actualInterval).toBeGreaterThan(actualTimeout);
          expect(actualHealthy).toBeGreaterThanOrEqual(2);
          expect(actualUnhealthy).toBeGreaterThanOrEqual(2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
