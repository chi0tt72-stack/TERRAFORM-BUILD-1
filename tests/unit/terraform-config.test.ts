import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..', '..');

function loadFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

const versionsTf = loadFile('environments/dev-github/versions.tf');
const tfbackend = loadFile('environments/dev-github/github.s3.tfbackend');
const computeAsgMain = loadFile('modules/compute-asg/main.tf');
const albMain = loadFile('modules/alb/main.tf');
const envMain = loadFile('environments/dev-github/main.tf');

// ---------------------------------------------------------------------------
// environments/dev-github/versions.tf — S3 backend
// Validates: Requirements 4.1, 4.4
// ---------------------------------------------------------------------------
describe('environments/dev-github/versions.tf', () => {
  it('has backend "s3" {} block', () => {
    expect(versionsTf).toMatch(/backend\s+"s3"\s*\{/);
  });
});

// ---------------------------------------------------------------------------
// environments/dev-github/github.s3.tfbackend — distinct state key
// Validates: Requirements 4.1, 4.2, 4.3
// ---------------------------------------------------------------------------
describe('environments/dev-github/github.s3.tfbackend', () => {
  it('has a state key containing "github"', () => {
    expect(tfbackend).toMatch(/key\s*=\s*"github\/terraform\.tfstate"/);
  });

  it('has a state key distinct from default GitLab state path', () => {
    // GitLab uses key = "terraform.tfstate" (no prefix)
    const keyMatch = tfbackend.match(/key\s*=\s*"([^"]+)"/);
    expect(keyMatch).not.toBeNull();
    expect(keyMatch![1]).not.toBe('terraform.tfstate');
  });
});

// ---------------------------------------------------------------------------
// modules/compute-asg/main.tf — resource presence
// Validates: Requirements 8.1, 8.2
// ---------------------------------------------------------------------------
describe('modules/compute-asg/main.tf', () => {
  it('has aws_launch_template resource', () => {
    expect(computeAsgMain).toMatch(/resource\s+"aws_launch_template"/);
  });

  it('has aws_autoscaling_group resource', () => {
    expect(computeAsgMain).toMatch(/resource\s+"aws_autoscaling_group"/);
  });

  it('has aws_key_pair resource', () => {
    expect(computeAsgMain).toMatch(/resource\s+"aws_key_pair"/);
  });

  it('has aws_security_group resource', () => {
    expect(computeAsgMain).toMatch(/resource\s+"aws_security_group"/);
  });

  // Validates: Requirements 19.1 — port 80 ingress uses security_groups, not cidr_blocks
  it('port 80 ingress uses security_groups (not cidr_blocks)', () => {
    // Extract the ingress block that references port 80
    const ingressBlocks = computeAsgMain.match(/ingress\s*\{[^}]*\}/gs) || [];
    const port80Block = ingressBlocks.find((block) =>
      /from_port\s*=\s*80/.test(block) && /to_port\s*=\s*80/.test(block)
    );
    expect(port80Block).toBeDefined();
    expect(port80Block!).toMatch(/security_groups\s*=/);
    expect(port80Block!).not.toMatch(/cidr_blocks\s*=/);
  });
});

// ---------------------------------------------------------------------------
// modules/alb/main.tf — resource presence
// Validates: Requirements 14.1, 14.2
// ---------------------------------------------------------------------------
describe('modules/alb/main.tf', () => {
  it('has aws_lb resource', () => {
    expect(albMain).toMatch(/resource\s+"aws_lb"\s+/);
  });

  it('has aws_lb_target_group resource', () => {
    expect(albMain).toMatch(/resource\s+"aws_lb_target_group"/);
  });

  it('has aws_lb_listener resource', () => {
    expect(albMain).toMatch(/resource\s+"aws_lb_listener"/);
  });

  it('has aws_security_group resource for ALB', () => {
    expect(albMain).toMatch(/resource\s+"aws_security_group"/);
  });
});

// ---------------------------------------------------------------------------
// environments/dev-github/main.tf — ALB + compute-asg wiring
// Validates: Requirements 18.1, 18.4, 19.1
// ---------------------------------------------------------------------------
describe('environments/dev-github/main.tf', () => {
  it('references module "alb"', () => {
    expect(envMain).toMatch(/module\s+"alb"\s*\{/);
  });

  it('references module "compute_asg"', () => {
    expect(envMain).toMatch(/module\s+"compute_asg"\s*\{/);
  });

  it('passes alb_security_group_id from ALB module to compute_asg', () => {
    expect(envMain).toMatch(/alb_security_group_id\s*=\s*module\.alb\.alb_security_group_id/);
  });

  it('passes target_group_arns from ALB module to compute_asg', () => {
    expect(envMain).toMatch(/target_group_arns\s*=\s*\[module\.alb\.target_group_arn\]/);
  });
});
