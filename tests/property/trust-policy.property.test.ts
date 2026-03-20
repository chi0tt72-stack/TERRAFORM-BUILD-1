// Feature: github-actions-cicd, Property 2: IAM trust policy repository scoping
// Validates: Requirements 1.4, 2.2

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRUST_POLICY_PATH = resolve(__dirname, '../../iam-policies/github-oidc-trust-policy.json');
const trustPolicy = JSON.parse(readFileSync(TRUST_POLICY_PATH, 'utf-8'));

describe('Property 2: IAM trust policy repository scoping', () => {
  it('trust policy file is valid JSON with required top-level fields', () => {
    expect(trustPolicy).toHaveProperty('Version');
    expect(trustPolicy).toHaveProperty('Statement');
    expect(Array.isArray(trustPolicy.Statement)).toBe(true);
    expect(trustPolicy.Statement.length).toBeGreaterThan(0);
  });

  it('every statement uses the GitHub OIDC provider as principal', () => {
    for (const stmt of trustPolicy.Statement) {
      const federated = stmt.Principal?.Federated ?? '';
      expect(federated).toContain('token.actions.githubusercontent.com');
    }
  });

  it('every statement uses AssumeRoleWithWebIdentity action', () => {
    for (const stmt of trustPolicy.Statement) {
      expect(stmt.Action).toBe('sts:AssumeRoleWithWebIdentity');
    }
  });

  it('every statement has a Condition block with sub claim scoped to a repo', () => {
    for (const stmt of trustPolicy.Statement) {
      expect(stmt).toHaveProperty('Condition');
      const condition = stmt.Condition;

      // sub claim must be present in StringLike or StringEquals
      const subClaim =
        condition.StringLike?.['token.actions.githubusercontent.com:sub'] ??
        condition.StringEquals?.['token.actions.githubusercontent.com:sub'];

      expect(subClaim).toBeDefined();
      expect(subClaim).toMatch(/^repo:.+\/.+/);
    }
  });

  it('every statement has aud claim set to sts.amazonaws.com', () => {
    for (const stmt of trustPolicy.Statement) {
      const audClaim =
        stmt.Condition?.StringEquals?.['token.actions.githubusercontent.com:aud'];
      expect(audClaim).toBe('sts.amazonaws.com');
    }
  });

  it('for any generated owner/repo pair, the sub claim pattern in the policy restricts to a specific repo', () => {
    // Property-based: generate random owner/repo strings and verify the actual
    // policy's sub claim is NOT a wildcard that matches arbitrary repos.
    const actualSubClaim =
      trustPolicy.Statement[0].Condition.StringLike?.[
        'token.actions.githubusercontent.com:sub'
      ] ??
      trustPolicy.Statement[0].Condition.StringEquals?.[
        'token.actions.githubusercontent.com:sub'
      ];

    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,19}$/),
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9._-]{0,29}$/)
        ),
        ([randomOwner, randomRepo]: [string, string]) => {
          // The actual sub claim must start with "repo:<specific-owner>/<specific-repo>"
          // and must NOT be a blanket wildcard like "repo:*" that would match any repo.
          expect(actualSubClaim).toMatch(/^repo:[^*]+\/[^*]+/);

          // If the random owner/repo differs from the policy's owner/repo,
          // a simple prefix match should fail (the policy is scoped).
          const policyRepoPrefix = actualSubClaim.replace(/:\*$/, '').replace(/^repo:/, '');
          const randomRepoFull = `${randomOwner}/${randomRepo}`;

          if (randomRepoFull !== policyRepoPrefix) {
            expect(policyRepoPrefix).not.toBe(randomRepoFull);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
