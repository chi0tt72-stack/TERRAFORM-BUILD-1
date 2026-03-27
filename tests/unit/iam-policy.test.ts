import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..', '..');

function loadPolicy(name: string): any {
  const content = readFileSync(resolve(ROOT, 'iam-policies', name), 'utf8');
  return JSON.parse(content);
}

const trustPolicy = loadPolicy('github-oidc-trust-policy.json');
const permissionsPolicy = loadPolicy('github-terraform-permissions.json');

// ---------------------------------------------------------------------------
// GitHub OIDC Trust Policy
// ---------------------------------------------------------------------------
describe('github-oidc-trust-policy.json', () => {
  const statement = trustPolicy.Statement[0];

  // Validates: Requirement 2.1 — trust policy references GitHub OIDC provider
  it('Principal.Federated contains the GitHub OIDC provider URL', () => {
    expect(statement.Principal.Federated).toContain(
      'token.actions.githubusercontent.com'
    );
  });

  // Validates: Requirement 2.2 — sub claim scoped to a specific repo
  it('has StringLike condition on sub claim scoped to a repo', () => {
    const subCondition =
      statement.Condition.StringLike[
        'token.actions.githubusercontent.com:sub'
      ];
    expect(subCondition).toBeDefined();
    expect(subCondition).toMatch(/^repo:.+\/.+:/);
  });

  // Validates: Requirement 2.1 — aud claim set to sts.amazonaws.com
  it('has StringEquals condition on aud claim set to sts.amazonaws.com', () => {
    const audCondition =
      statement.Condition.StringEquals[
        'token.actions.githubusercontent.com:aud'
      ];
    expect(audCondition).toBe('sts.amazonaws.com');
  });

  // Validates: Requirement 1.4 — action is AssumeRoleWithWebIdentity
  it('Action is sts:AssumeRoleWithWebIdentity', () => {
    expect(statement.Action).toBe('sts:AssumeRoleWithWebIdentity');
  });
});

// ---------------------------------------------------------------------------
// GitHub Terraform Permissions Policy
// ---------------------------------------------------------------------------
describe('github-terraform-permissions.json', () => {
  const actions: string[] = permissionsPolicy.Statement.flatMap(
    (s: any) => s.Action
  );

  const requiredPrefixes = [
    'ec2',
    'autoscaling',
    'elasticloadbalancing',
    's3',
    'cloudwatch',
    'sns',
    'iam',
    'secretsmanager',
    'kms',
  ];

  // Validates: Requirement 2.3 — all required service prefixes present
  it.each(requiredPrefixes)(
    'includes at least one action for %s',
    (prefix) => {
      const hasAction = actions.some((a) =>
        a.toLowerCase().startsWith(prefix.toLowerCase() + ':')
      );
      expect(hasAction).toBe(true);
    }
  );

  // Validates: Requirement 2.3 — specific IAM actions
  it('includes iam:GetRole and iam:PassRole', () => {
    expect(actions).toContain('iam:GetRole');
    expect(actions).toContain('iam:PassRole');
  });

  // Validates: Requirement 2.3 — Secrets Manager read access
  it('includes secretsmanager:GetSecretValue', () => {
    expect(actions).toContain('secretsmanager:GetSecretValue');
  });

  // Validates: Requirement 2.3 — KMS decrypt access
  it('includes kms:Decrypt', () => {
    expect(actions).toContain('kms:Decrypt');
  });
});
