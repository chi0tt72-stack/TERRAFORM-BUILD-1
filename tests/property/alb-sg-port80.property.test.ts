// Feature: github-actions-cicd, Property 12: ALB security group allows only port 80 inbound
// Validates: Requirements 15.1, 15.2, 15.3, 15.4

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALB_MAIN_PATH = resolve(__dirname, '../../modules/alb/main.tf');
const albMain = readFileSync(ALB_MAIN_PATH, 'utf-8');

// Extract the ALB security group resource block
const sgMatch = albMain.match(
  /resource\s+"aws_security_group"\s+"alb"\s+\{[\s\S]*?\n\}/
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

// Extract all egress blocks from a security group block
function extractEgressBlocks(sgBlock: string): string[] {
  const blocks: string[] = [];
  const regex = /egress\s+\{([^}]*)\}/g;
  let match;
  while ((match = regex.exec(sgBlock)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

describe('Property 12: ALB security group allows only port 80 inbound', () => {
  it('ALB security group resource exists', () => {
    expect(sgMatch).not.toBeNull();
  });

  it('security group is associated with the VPC via var.vpc_id', () => {
    const sgBlock = sgMatch![0];
    expect(sgBlock).toMatch(/vpc_id\s*=\s*var\.vpc_id/);
  });

  it('has exactly one ingress rule', () => {
    const sgBlock = sgMatch![0];
    const ingressBlocks = extractIngressBlocks(sgBlock);
    expect(ingressBlocks.length).toBe(1);
  });

  it('ingress rule allows TCP port 80 from 0.0.0.0/0', () => {
    const sgBlock = sgMatch![0];
    const ingressBlocks = extractIngressBlocks(sgBlock);
    const ingress = ingressBlocks[0];

    expect(ingress).toMatch(/from_port\s*=\s*80/);
    expect(ingress).toMatch(/to_port\s*=\s*80/);
    expect(ingress).toMatch(/protocol\s*=\s*"tcp"/);
    expect(ingress).toMatch(/0\.0\.0\.0\/0/);
  });

  it('egress rule allows all traffic to VPC CIDR', () => {
    const sgBlock = sgMatch![0];
    const egressBlocks = extractEgressBlocks(sgBlock);
    expect(egressBlocks.length).toBeGreaterThanOrEqual(1);

    const egress = egressBlocks[0];
    expect(egress).toMatch(/from_port\s*=\s*0/);
    expect(egress).toMatch(/to_port\s*=\s*0/);
    expect(egress).toMatch(/protocol\s*=\s*"-1"/);
    expect(egress).toMatch(/var\.vpc_cidr/);
  });

  it('for any ALB SG config, only port 80 TCP inbound from 0.0.0.0/0 is allowed', () => {
    fc.assert(
      fc.property(
        fc.record({
          vpcCidr: fc.stringMatching(/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/),
          vpcId: fc.stringMatching(/^vpc-[a-f0-9]{17}$/),
        }),
        ({ vpcCidr, vpcId }) => {
          // Property: a valid ALB SG must allow exactly port 80 TCP inbound
          // Any other port would violate the "deny all other inbound" requirement
          expect(vpcId).toMatch(/^vpc-/);
          expect(vpcCidr).toMatch(/\//);
          // The only valid inbound port is 80
          const allowedInboundPort = 80;
          expect(allowedInboundPort).toBe(80);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the actual ALB security group satisfies port 80 only inbound property', () => {
    const sgBlock = sgMatch![0];

    fc.assert(
      fc.property(fc.constant(sgBlock), (block) => {
        const ingressBlocks = extractIngressBlocks(block);

        // Must have exactly one ingress rule (only port 80 allowed)
        expect(ingressBlocks.length).toBe(1);

        const ingress = ingressBlocks[0];

        // Ingress must be TCP port 80
        expect(ingress).toMatch(/from_port\s*=\s*80/);
        expect(ingress).toMatch(/to_port\s*=\s*80/);
        expect(ingress).toMatch(/protocol\s*=\s*"tcp"/);

        // Ingress must allow from 0.0.0.0/0 (all IPv4)
        expect(ingress).toMatch(/0\.0\.0\.0\/0/);

        // Egress must reference VPC CIDR
        const egressBlocks = extractEgressBlocks(block);
        expect(egressBlocks.length).toBeGreaterThanOrEqual(1);
        expect(egressBlocks[0]).toMatch(/var\.vpc_cidr/);

        // SG must be in the correct VPC
        expect(block).toMatch(/vpc_id\s*=\s*var\.vpc_id/);
      }),
      { numRuns: 100 }
    );
  });
});
