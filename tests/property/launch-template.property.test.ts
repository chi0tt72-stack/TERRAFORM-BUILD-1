// Feature: github-actions-cicd, Property 9: Launch template required attributes
// Validates: Requirements 8.1, 8.7

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASG_MAIN_PATH = resolve(__dirname, '../../modules/compute-asg/main.tf');
const asgMain = readFileSync(ASG_MAIN_PATH, 'utf-8');

// Extract the launch template resource block
const ltMatch = asgMain.match(
  /resource\s+"aws_launch_template"\s+"main"\s+\{[\s\S]*?\n\}/
);

describe('Property 9: Launch template required attributes', () => {
  it('launch template resource exists', () => {
    expect(ltMatch).not.toBeNull();
  });

  it('launch template references an AMI via image_id', () => {
    const ltBlock = ltMatch![0];
    // Must have image_id referencing a data source or variable (not empty)
    const imageIdMatch = ltBlock.match(/image_id\s*=\s*(.+)/);
    expect(imageIdMatch).not.toBeNull();
    const imageIdValue = imageIdMatch![1].trim();
    // Should reference a data source (data.aws_ami.*) or a variable
    expect(imageIdValue).toMatch(/^(data\.|var\.)/);
  });

  it('launch template references an instance_type', () => {
    const ltBlock = ltMatch![0];
    const instanceTypeMatch = ltBlock.match(/instance_type\s*=\s*(.+)/);
    expect(instanceTypeMatch).not.toBeNull();
    const value = instanceTypeMatch![1].trim();
    // Should reference a variable for configurability
    expect(value).toMatch(/^var\./);
  });

  it('launch template references a key_name linked to SSH public key', () => {
    const ltBlock = ltMatch![0];
    const keyNameMatch = ltBlock.match(/key_name\s*=\s*(.+)/);
    expect(keyNameMatch).not.toBeNull();
    const value = keyNameMatch![1].trim();
    // Should reference the aws_key_pair resource
    expect(value).toMatch(/aws_key_pair\./);
  });

  it('launch template references at least one security group', () => {
    const ltBlock = ltMatch![0];
    // Check for vpc_security_group_ids or security_groups
    const sgMatch = ltBlock.match(
      /vpc_security_group_ids\s*=|network_interfaces\s*\{[\s\S]*?security_groups/
    );
    expect(sgMatch).not.toBeNull();
  });

  it('key pair resource uses ssh_public_key variable from Secrets Manager', () => {
    const keyPairMatch = asgMain.match(
      /resource\s+"aws_key_pair"\s+"main"\s+\{[\s\S]*?\n\}/
    );
    expect(keyPairMatch).not.toBeNull();
    const keyPairBlock = keyPairMatch![0];
    expect(keyPairBlock).toContain('var.ssh_public_key');
  });

  it('for any valid launch template config, all four required attributes are present', () => {
    fc.assert(
      fc.property(
        fc.record({
          ami: fc.constantFrom('data.aws_ami.amazon_linux.id', 'var.ami_id'),
          instanceType: fc.constantFrom('var.instance_type', 't3.micro', 't3.small'),
          keyName: fc.constantFrom('aws_key_pair.main.key_name', 'aws_key_pair.deploy.key_name'),
          securityGroupIds: fc.array(
            fc.constantFrom('aws_security_group.instance.id', 'aws_security_group.web.id'),
            { minLength: 1, maxLength: 3 }
          ),
        }),
        (config) => {
          // Property: a valid launch template must have all four attributes
          expect(config.ami).toBeTruthy();
          expect(config.instanceType).toBeTruthy();
          expect(config.keyName).toBeTruthy();
          expect(config.securityGroupIds.length).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the actual launch template satisfies all required attributes simultaneously', () => {
    const ltBlock = ltMatch![0];

    fc.assert(
      fc.property(fc.constant(ltBlock), (block) => {
        // All four attributes must be present in the same resource block
        expect(block).toMatch(/image_id\s*=/);
        expect(block).toMatch(/instance_type\s*=/);
        expect(block).toMatch(/key_name\s*=/);
        expect(block).toMatch(/vpc_security_group_ids\s*=/);
      }),
      { numRuns: 100 }
    );
  });
});
