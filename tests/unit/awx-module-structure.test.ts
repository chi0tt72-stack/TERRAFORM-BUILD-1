import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..', '..');

function loadFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// Validates: Requirements 1.2, 1.5 — AWX module file structure
// ---------------------------------------------------------------------------
describe('modules/awx/ file structure', () => {
  it('contains main.tf', () => {
    expect(existsSync(resolve(ROOT, 'modules/awx/main.tf'))).toBe(true);
  });

  it('contains variables.tf', () => {
    expect(existsSync(resolve(ROOT, 'modules/awx/variables.tf'))).toBe(true);
  });

  it('contains outputs.tf', () => {
    expect(existsSync(resolve(ROOT, 'modules/awx/outputs.tf'))).toBe(true);
  });

  it('contains templates/user_data.sh.tpl', () => {
    expect(existsSync(resolve(ROOT, 'modules/awx/templates/user_data.sh.tpl'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validates: Requirements 13.1, 13.2, 13.3 — AWX module wired into environment
// ---------------------------------------------------------------------------
describe('environments/dev-github/main.tf — AWX module integration', () => {
  const envMain = loadFile('environments/dev-github/main.tf');

  it('includes module "awx" block', () => {
    expect(envMain).toMatch(/module\s+"awx"\s*\{/);
  });

  it('uses conditional count with enable_awx', () => {
    expect(envMain).toMatch(/count\s*=\s*var\.enable_awx\s*\?\s*1\s*:\s*0/);
  });

  it('wires vpc_id from networking module', () => {
    expect(envMain).toMatch(/vpc_id\s*=\s*module\.networking\.vpc_id/);
  });

  it('wires subnet_id from networking module', () => {
    expect(envMain).toMatch(/subnet_id\s*=\s*module\.networking\.public_subnet_ids\[0\]/);
  });

  it('wires ec2_security_group_id from compute_asg module', () => {
    expect(envMain).toMatch(/ec2_security_group_id\s*=\s*module\.compute_asg\.security_group_id/);
  });
});

// ---------------------------------------------------------------------------
// Validates: Requirements 1.6, 13.4 — AWX outputs in environment
// ---------------------------------------------------------------------------
describe('environments/dev-github/outputs.tf — AWX outputs', () => {
  const envOutputs = loadFile('environments/dev-github/outputs.tf');

  it('includes awx_private_ip output', () => {
    expect(envOutputs).toMatch(/output\s+"awx_private_ip"/);
  });

  it('awx_private_ip is conditional on enable_awx', () => {
    expect(envOutputs).toMatch(/var\.enable_awx/);
  });
});

// ---------------------------------------------------------------------------
// Validates: Requirements 1.7, 13.5 — AWX variables in environment
// ---------------------------------------------------------------------------
describe('environments/dev-github/variables.tf — AWX variables', () => {
  const envVars = loadFile('environments/dev-github/variables.tf');

  it('includes enable_awx variable', () => {
    expect(envVars).toMatch(/variable\s+"enable_awx"/);
  });

  it('enable_awx defaults to false', () => {
    // Match the default value within the enable_awx variable block
    const enableAwxBlock = envVars.match(/variable\s+"enable_awx"\s*\{[^}]*\}/s);
    expect(enableAwxBlock).not.toBeNull();
    expect(enableAwxBlock![0]).toMatch(/default\s*=\s*false/);
  });

  it('enable_awx is of type bool', () => {
    const enableAwxBlock = envVars.match(/variable\s+"enable_awx"\s*\{[^}]*\}/s);
    expect(enableAwxBlock).not.toBeNull();
    expect(enableAwxBlock![0]).toMatch(/type\s*=\s*bool/);
  });
});
