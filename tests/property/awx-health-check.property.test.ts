// Feature: awx-integration, Property 4: AWX health check retry logic correctness
// Validates: Requirements 11.2, 11.3

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// --- Pure function modelling the bash health check logic in terraform-apply.yml ---

type HealthCheckResult = { outcome: 'healthy' } | { outcome: 'timeout' };

const HEALTH_INTERVAL = 10; // seconds
const HEALTH_TIMEOUT = 300; // seconds

/**
 * Simulates the AWX health check retry logic.
 *
 * `responseSequence` represents the HTTP response for each successive poll.
 * `true` means HTTP 200 (healthy), `false` means any other response (unhealthy).
 * The function walks through the sequence one response per poll tick (every 10s).
 * If the sequence is exhausted before a healthy response, the remaining polls
 * return the last value in the sequence (the server stays in that state).
 */
function checkAwxHealth(responseSequence: boolean[]): HealthCheckResult {
  let elapsed = 0;

  // Guard: no responses means we keep polling until timeout
  if (responseSequence.length === 0) {
    return { outcome: 'timeout' };
  }

  let index = 0;

  while (elapsed < HEALTH_TIMEOUT) {
    const isHealthy = responseSequence[Math.min(index, responseSequence.length - 1)];

    if (isHealthy) {
      return { outcome: 'healthy' };
    }

    // Not healthy — retry after interval
    elapsed += HEALTH_INTERVAL;
    index++;
  }

  return { outcome: 'timeout' };
}

// --- Arbitraries ---

const healthResponseArb: fc.Arbitrary<boolean> = fc.boolean();
const failureResponseArb: fc.Arbitrary<boolean> = fc.constant(false);
const successResponseArb: fc.Arbitrary<boolean> = fc.constant(true);

describe('Property 4: AWX health check retry logic correctness', () => {
  it('returns healthy on first successful response (Req 11.2)', () => {
    fc.assert(
      fc.property(
        fc.array(failureResponseArb, { minLength: 0, maxLength: 20 }).chain((prefix) =>
          fc.constant([...prefix, true]),
        ),
        (sequence) => {
          // Only expect healthy if the failures fit within the timeout window
          const failureCount = sequence.length - 1; // last element is the success
          const elapsedBeforeSuccess = failureCount * HEALTH_INTERVAL;
          if (elapsedBeforeSuccess < HEALTH_TIMEOUT) {
            const result = checkAwxHealth(sequence);
            expect(result.outcome).toBe('healthy');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('retries every 10 seconds on failure (Req 11.3)', () => {
    // Verify that N failures followed by success returns healthy
    // only when N * 10 < 300 (i.e., the failures fit within the timeout)
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 29 }), // 0..29 failures before success (29 * 10 = 290 < 300)
        (failureCount) => {
          const sequence = [
            ...Array(failureCount).fill(false),
            true,
          ];
          const result = checkAwxHealth(sequence);
          expect(result.outcome).toBe('healthy');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns timeout after 300 seconds with no successful response (Req 11.2)', () => {
    // 300 / 10 = 30 polls needed to reach timeout
    const minPollsForTimeout = Math.ceil(HEALTH_TIMEOUT / HEALTH_INTERVAL);

    fc.assert(
      fc.property(
        fc.array(failureResponseArb, { minLength: minPollsForTimeout, maxLength: minPollsForTimeout + 10 }),
        (sequence) => {
          const result = checkAwxHealth(sequence);
          expect(result.outcome).toBe('timeout');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any arbitrary response sequence, outcome is always healthy or timeout', () => {
    fc.assert(
      fc.property(
        fc.array(healthResponseArb, { minLength: 0, maxLength: 50 }),
        (sequence) => {
          const result = checkAwxHealth(sequence);
          expect(['healthy', 'timeout']).toContain(result.outcome);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('first success in sequence determines the outcome regardless of later values', () => {
    fc.assert(
      fc.property(
        fc.array(failureResponseArb, { minLength: 0, maxLength: 20 }).chain((prefix) =>
          fc.array(healthResponseArb, { minLength: 0, maxLength: 10 }).map((suffix) => ({
            prefix,
            sequence: [...prefix, true, ...suffix],
          })),
        ),
        ({ prefix, sequence }) => {
          const elapsedBeforeSuccess = prefix.length * HEALTH_INTERVAL;
          if (elapsedBeforeSuccess < HEALTH_TIMEOUT) {
            const result = checkAwxHealth(sequence);
            expect(result.outcome).toBe('healthy');
          } else {
            const result = checkAwxHealth(sequence);
            expect(result.outcome).toBe('timeout');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('exactly 30 failures causes timeout (boundary case)', () => {
    // 30 failures * 10s = 300s which equals the timeout, so the loop condition
    // (elapsed < TIMEOUT) is no longer true after 30 failures
    fc.assert(
      fc.property(
        fc.constant(Array(30).fill(false) as boolean[]),
        (sequence) => {
          const result = checkAwxHealth(sequence);
          expect(result.outcome).toBe('timeout');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('29 failures followed by success returns healthy (boundary case)', () => {
    fc.assert(
      fc.property(
        fc.constant([...Array(29).fill(false), true] as boolean[]),
        (sequence) => {
          const result = checkAwxHealth(sequence);
          expect(result.outcome).toBe('healthy');
        },
      ),
      { numRuns: 100 },
    );
  });
});
