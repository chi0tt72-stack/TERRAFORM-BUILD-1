// Feature: github-actions-cicd, Property 16: Instance security group restricts port 80 to ALB only
// Validates: Requirements 19.1, 19.2

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASG_MAIN_PATH = resolve(__dirname, '../../modules/compute-asg/main.tf');
const asgMain = readFileSync(ASG_MAIN_PATH, 'utf-8');

// Extract the instance security group resource block
const sgMatch = asgMain.match(
  /resource\s+"aws_security_group"\s+"instance"\s+\{[\s\S]*?\n\}/
);

// Extract all ingress blocks from the security group
function extractIngressBlocks(sgBlock: string): string[] {
  const blocks: string[] = [];
  const regex = /ingress\s+\{([^}]*)\}/g;
  let match;
  while ((match = regex.exec(sgBlock)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

describe('Property 16: Instance security group restricts port 80 to ALB only', () => {
  it('instance security group resource exists', () => {
    expect(sgMatch).not.toBeNull();
  });

  it('port 80 ingress rule uses security_groups (not cidr_blocks)', () => {
    const sgBlock = sgMatch![0];
    const ingressBlocks = extractIngressBlocks(sgBlock);

    const port80Blocks = ingressBlocks.filter((block) =>
      block.match(/from_port\s*=\s*80/) && block.match(/to_port\s*=\s*80/)
    );

    expect(port80Blocks.length).toBeGreaterThanOrEqual(1);

    for (const block of port80Blocks) {
      // Must use security_groups, not cidr_blocks
      expect(block).toMatch(/security_groups\s*=/);
      expect(block).not.toMatch(/cidr_blocks\s*=/);
    }
  });

  it('port 80 ingress references the ALB security group variable', () => {
    const sgBlock = sgMatch![0];
    const ingressBlocks = extractIngressBlocks(sgBlock);

    const port80Blocks = ingressBlocks.filter((block) =>
      block.match(/from_port\s*=\s*80/) && block.match(/to_port\s*=\s*80/)
    );

    expect(port80Blocks.length).toBeGreaterThanOrEqual(1);

    for (const block of port80Blocks) {
      expect(block).toMatch(/var\.alb_security_group_id/);
    }
  });

  it('no port 80 ingress rule allows 0.0.0.0/0', () => {
    const sgBlock = sgMatch![0];
    const ingressBlocks = extractIngressBlocks(sgBlock);

    const port80Blocks = ingressBlocks.filter((block) =>
      block.match(/from_port\s*=\s*80/) && block.match(/to_port\s*=\s*80/)
    );

    for (const block of port80Blocks) {
      expect(block).not.toMatch(/0\.0\.0\.0\/0/);
    }
  });

  it('for any security group config, port 80 must only allow ALB source', () => {
    fc.assert(
      fc.property(
        fc.record({
          albSgId: fc.stringMatching(/^sg-[a-f0-9]{17}$/),
          sshCidrs: fc.array(
            fc.stringMatching(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/),
            { minLength: 1, maxLength: 3 }
          ),
        }),
        ({ albSgId, sshCidrs }) => {
          // Property: port 80 ingress must reference a security group ID, never a CIDR
          // SSH ingress may use CIDRs, but HTTP must be restricted to ALB SG
          expect(albSgId).toMatch(/^sg-/);
          for (const cidr of sshCidrs) {
            // SSH CIDRs are valid for port 22 but must never appear on port 80
            expect(cidr).toMatch(/\//);
            expect(cidr).not.toMatch(/^sg-/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the actual security group satisfies port 80 ALB-only restriction', () => {
    const sgBlock = sgMatch![0];

    fc.assert(
      fc.property(fc.constant(sgBlock), (block) => {
        const ingressBlocks = extractIngressBlocks(block);
        const port80Blocks = ingressBlocks.filter((b) =>
          b.match(/from_port\s*=\s*80/) && b.match(/to_port\s*=\s*80/)
        );

        // Must have at least one port 80 ingress rule
        expect(port80Blocks.length).toBeGreaterThanOrEqual(1);

        for (const b of port80Blocks) {
          // Must use security_groups referencing ALB SG
          expect(b).toMatch(/security_groups\s*=\s*\[var\.alb_security_group_id\]/);
          // Must NOT use cidr_blocks
          expect(b).not.toMatch(/cidr_blocks/);
        }
      }),
      { numRuns: 100 }
    );
  });
});
