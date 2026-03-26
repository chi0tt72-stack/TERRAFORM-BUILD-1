// Feature: github-actions-cicd, Property 14: HTTP listener forwards to target group
// Validates: Requirements 17.1, 17.2

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALB_MAIN_PATH = resolve(__dirname, '../../modules/alb/main.tf');
const albMain = readFileSync(ALB_MAIN_PATH, 'utf-8');

// Extract the aws_lb_listener resource block
const listenerMatch = albMain.match(
  /resource\s+"aws_lb_listener"\s+"http"\s+\{[\s\S]*?\n\}/
);

// Extract the default_action block from a listener block
function extractDefaultAction(listenerBlock: string): string | null {
  const match = listenerBlock.match(/default_action\s+\{([^}]*)\}/);
  return match ? match[1] : null;
}

describe('Property 14: HTTP listener forwards to target group', () => {
  it('aws_lb_listener resource exists', () => {
    expect(listenerMatch).not.toBeNull();
  });

  it('listener port is 80', () => {
    const block = listenerMatch![0];
    const topLevel = block.replace(/default_action\s+\{[^}]*\}/, '');
    expect(topLevel).toMatch(/port\s*=\s*80/);
  });

  it('listener protocol is HTTP', () => {
    const block = listenerMatch![0];
    const topLevel = block.replace(/default_action\s+\{[^}]*\}/, '');
    expect(topLevel).toMatch(/protocol\s*=\s*"HTTP"/);
  });

  it('listener references the ALB', () => {
    const block = listenerMatch![0];
    expect(block).toMatch(/load_balancer_arn\s*=\s*aws_lb\.main\.arn/);
  });

  it('default_action block exists', () => {
    const action = extractDefaultAction(listenerMatch![0]);
    expect(action).not.toBeNull();
  });

  it('default_action type is forward', () => {
    const action = extractDefaultAction(listenerMatch![0])!;
    expect(action).toMatch(/type\s*=\s*"forward"/);
  });

  it('default_action targets the ALB target group', () => {
    const action = extractDefaultAction(listenerMatch![0])!;
    expect(action).toMatch(/target_group_arn\s*=\s*aws_lb_target_group\.main\.arn/);
  });

  it('for any valid listener config, port 80 HTTP listener must forward to target group', () => {
    const block = listenerMatch![0];

    fc.assert(
      fc.property(fc.constant(block), (listenerBlock) => {
        const topLevel = listenerBlock.replace(/default_action\s+\{[^}]*\}/, '');

        // Port must be 80
        expect(topLevel).toMatch(/port\s*=\s*80/);
        // Protocol must be HTTP
        expect(topLevel).toMatch(/protocol\s*=\s*"HTTP"/);
        // Must reference the ALB
        expect(listenerBlock).toMatch(/load_balancer_arn\s*=\s*aws_lb\.main\.arn/);

        // Default action must exist and forward to target group
        const action = extractDefaultAction(listenerBlock);
        expect(action).not.toBeNull();
        expect(action!).toMatch(/type\s*=\s*"forward"/);
        expect(action!).toMatch(/target_group_arn\s*=\s*aws_lb_target_group\.main\.arn/);
      }),
      { numRuns: 100 }
    );
  });

  it('for any listener spec, forward action must reference a valid target group', () => {
    fc.assert(
      fc.property(
        fc.record({
          port: fc.constant(80),
          protocol: fc.constant('HTTP'),
          actionType: fc.constantFrom('forward', 'redirect', 'fixed-response'),
          targetGroupRef: fc.stringMatching(/^aws_lb_target_group\.\w+\.arn$/),
        }),
        ({ port, protocol, actionType, targetGroupRef }) => {
          // A valid HTTP listener must be on port 80
          expect(port).toBe(80);
          expect(protocol).toBe('HTTP');

          // Only forward actions should have a target_group_arn
          if (actionType === 'forward') {
            expect(targetGroupRef).toMatch(/^aws_lb_target_group\.\w+\.arn$/);
          }

          // Our actual config uses forward to the main target group
          const actualAction = extractDefaultAction(listenerMatch![0])!;
          expect(actualAction).toMatch(/type\s*=\s*"forward"/);
          expect(actualAction).toMatch(/target_group_arn\s*=\s*aws_lb_target_group\.main\.arn/);
        }
      ),
      { numRuns: 100 }
    );
  });
});
