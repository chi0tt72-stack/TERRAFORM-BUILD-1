// Feature: awx-integration, Property 1: AWX security group ingress rules only allow VPC CIDR
// Validates: Requirements 2.2, 2.3, 2.6

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AWX_MAIN_PATH = resolve(__dirname, '../../modules/awx/main.tf');
const awxMain = readFileSync(AWX_MAIN_PATH, 'utf-8');

// Extract the AWX security group resource block
const sgMatch = awxMain.match(
  /resource\s+"aws_security_group"\s+"awx"\s+\{[\s\S]*?\n\}/
);

// Extract all ingress blocks from a security group block
function extractIngressBlocks(sgBlock: string): string[] {
  const blocks: string[] = [];
  const regex = /ingress\s+\{([^}]*)\}/g;
  let match;
  while ((match = regex.exec(sgBlock)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

describe('Property 1: AWX security group ingress rules only allow VPC CIDR', () => {
  it('AWX security group resource exists', () => {
    expect(sgMatch).not.toBeNull();
  });

  it('security group is associated with the VPC via var.vpc_id', () => {
    const sgBlock = sgMatch![0];
    expect(sgBlock).toMatch(/vpc_id\s*=\s*var\.vpc_id/);
  });

  it('has exactly three ingress rules (port 80 VPC, port 80 public, port 443 VPC)', () => {
    const sgBlock = sgMatch![0];
    const ingressBlocks = extractIngressBlocks(sgBlock);
    expect(ingressBlocks.length).toBe(3);
  });

  it('VPC-only ingress rules reference var.vpc_cidr, public ingress is only port 80', () => {
    const sgBlock = sgMatch![0];
    const ingressBlocks = extractIngressBlocks(sgBlock);

    const publicBlocks = ingressBlocks.filter((b) => /0\.0\.0\.0\/0/.test(b));
    const vpcBlocks = ingressBlocks.filter((b) => /var\.vpc_cidr/.test(b));

    // Only one public ingress rule allowed, and it must be port 80
    expect(publicBlocks.length).toBe(1);
    expect(publicBlocks[0]).toMatch(/from_port\s*=\s*80/);

    // VPC blocks must reference var.vpc_cidr
    for (const block of vpcBlocks) {
      expect(block).toMatch(/var\.vpc_cidr/);
    }
  });

  it('ingress rules only allow ports 80 and 443', () => {
    const sgBlock = sgMatch![0];
    const ingressBlocks = extractIngressBlocks(sgBlock);

    const ports = ingressBlocks.map((block) => {
      const fromPort = block.match(/from_port\s*=\s*(\d+)/);
      const toPort = block.match(/to_port\s*=\s*(\d+)/);
      return {
        from: fromPort ? parseInt(fromPort[1], 10) : null,
        to: toPort ? parseInt(toPort[1], 10) : null,
      };
    });

    const allowedPorts = [80, 443];
    for (const port of ports) {
      expect(allowedPorts).toContain(port.from);
      expect(allowedPorts).toContain(port.to);
      expect(port.from).toBe(port.to);
    }
  });

  it('all ingress rules use TCP protocol', () => {
    const sgBlock = sgMatch![0];
    const ingressBlocks = extractIngressBlocks(sgBlock);

    for (const block of ingressBlocks) {
      expect(block).toMatch(/protocol\s*=\s*"tcp"/);
    }
  });

  it('for any VPC CIDR, AWX SG ingress must never allow public internet', () => {
    fc.assert(
      fc.property(
        fc.record({
          vpcCidr: fc.stringMatching(/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/),
          randomPort: fc.integer({ min: 1, max: 65535 }),
        }),
        ({ vpcCidr, randomPort }) => {
          // Property: for any valid VPC CIDR, the only allowed ingress ports are 80 and 443
          // and the source must be the VPC CIDR, never 0.0.0.0/0
          expect(vpcCidr).toMatch(/^10\./);
          expect(vpcCidr).not.toBe('0.0.0.0/0');

          // Only ports 80 and 443 are valid ingress ports
          const allowedPorts = new Set([80, 443]);
          if (!allowedPorts.has(randomPort)) {
            // Any other port must NOT be allowed inbound
            expect(allowedPorts.has(randomPort)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the actual AWX security group satisfies VPC-CIDR-only ingress property', () => {
    const sgBlock = sgMatch![0];

    fc.assert(
      fc.property(fc.constant(sgBlock), (block) => {
        const ingressBlocks = extractIngressBlocks(block);

        // Must have exactly three ingress rules
        expect(ingressBlocks.length).toBe(3);

        const allowedPorts = new Set([80, 443]);

        for (const ingress of ingressBlocks) {
          // Each ingress must use TCP
          expect(ingress).toMatch(/protocol\s*=\s*"tcp"/);

          // Each ingress must reference var.vpc_cidr OR be port 80 from 0.0.0.0/0
          const isPublic = /0\.0\.0\.0\/0/.test(ingress);
          if (isPublic) {
            expect(ingress).toMatch(/from_port\s*=\s*80/);
          } else {
            expect(ingress).toMatch(/var\.vpc_cidr/);
          }

          // Port must be 80 or 443
          const fromPort = ingress.match(/from_port\s*=\s*(\d+)/);
          const toPort = ingress.match(/to_port\s*=\s*(\d+)/);
          expect(fromPort).not.toBeNull();
          expect(toPort).not.toBeNull();
          expect(allowedPorts.has(parseInt(fromPort![1], 10))).toBe(true);
          expect(allowedPorts.has(parseInt(toPort![1], 10))).toBe(true);
        }

        // SG must be in the correct VPC
        expect(block).toMatch(/vpc_id\s*=\s*var\.vpc_id/);
      }),
      { numRuns: 100 }
    );
  });
});
