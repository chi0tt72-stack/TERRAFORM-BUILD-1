// Feature: awx-integration, Property 3: AWX job polling state machine correctness
// Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// --- Pure state machine modelling the bash polling logic in terraform-apply.yml ---

type AwxJobStatus = 'pending' | 'running' | 'successful' | 'failed' | 'error';

type PollResult =
  | { outcome: 'success' }
  | { outcome: 'failure'; status: 'failed' | 'error' }
  | { outcome: 'timeout' };

const POLL_INTERVAL = 15; // seconds
const POLL_TIMEOUT = 600; // seconds

/**
 * Simulates the AWX job polling state machine.
 *
 * `statusSequence` represents the status returned by each successive poll.
 * The function walks through the sequence one status per poll tick (every 15s).
 * If the sequence is exhausted before a terminal status, the remaining polls
 * return the last status in the sequence (the job stays in that state).
 */
function pollAwxJob(statusSequence: AwxJobStatus[]): PollResult {
  let elapsed = 0;

  // Guard: need at least one status
  if (statusSequence.length === 0) {
    // With no status responses, we just keep polling until timeout
    return { outcome: 'timeout' };
  }

  let index = 0;

  while (elapsed < POLL_TIMEOUT) {
    const status = statusSequence[Math.min(index, statusSequence.length - 1)];

    switch (status) {
      case 'successful':
        return { outcome: 'success' };
      case 'failed':
        return { outcome: 'failure', status: 'failed' };
      case 'error':
        return { outcome: 'failure', status: 'error' };
      case 'pending':
      case 'running':
        // continue polling
        break;
    }

    elapsed += POLL_INTERVAL;
    index++;
  }

  return { outcome: 'timeout' };
}

// --- Arbitraries ---

const awxStatusArb: fc.Arbitrary<AwxJobStatus> = fc.constantFrom(
  'pending',
  'running',
  'successful',
  'failed',
  'error',
);

const continuableStatusArb: fc.Arbitrary<AwxJobStatus> = fc.constantFrom('pending', 'running');
const terminalSuccessArb: fc.Arbitrary<AwxJobStatus> = fc.constant('successful' as AwxJobStatus);
const terminalFailureArb: fc.Arbitrary<AwxJobStatus> = fc.constantFrom('failed' as AwxJobStatus, 'error' as AwxJobStatus);


describe('Property 3: AWX job polling state machine correctness', () => {
  it('returns success when status sequence ends with "successful" (Req 10.3)', () => {
    fc.assert(
      fc.property(
        fc.array(continuableStatusArb, { minLength: 0, maxLength: 30 }).chain((prefix) =>
          fc.constant([...prefix, 'successful' as AwxJobStatus]),
        ),
        (sequence) => {
          const result = pollAwxJob(sequence);
          expect(result.outcome).toBe('success');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns failure when status sequence ends with "failed" (Req 10.4)', () => {
    fc.assert(
      fc.property(
        fc.array(continuableStatusArb, { minLength: 0, maxLength: 30 }).chain((prefix) =>
          fc.constant([...prefix, 'failed' as AwxJobStatus]),
        ),
        (sequence) => {
          const result = pollAwxJob(sequence);
          expect(result.outcome).toBe('failure');
          if (result.outcome === 'failure') {
            expect(result.status).toBe('failed');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns failure when status sequence ends with "error" (Req 10.4)', () => {
    fc.assert(
      fc.property(
        fc.array(continuableStatusArb, { minLength: 0, maxLength: 30 }).chain((prefix) =>
          fc.constant([...prefix, 'error' as AwxJobStatus]),
        ),
        (sequence) => {
          const result = pollAwxJob(sequence);
          expect(result.outcome).toBe('failure');
          if (result.outcome === 'failure') {
            expect(result.status).toBe('error');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('continues polling on "pending" and "running" until terminal status (Req 10.1, 10.2)', () => {
    fc.assert(
      fc.property(
        fc.array(continuableStatusArb, { minLength: 1, maxLength: 30 }).chain((prefix) =>
          fc.oneof(terminalSuccessArb, terminalFailureArb).map((terminal) => ({
            prefix,
            terminal,
            sequence: [...prefix, terminal],
          })),
        ),
        ({ prefix, terminal, sequence }) => {
          const result = pollAwxJob(sequence);

          // The prefix length * POLL_INTERVAL must be < TIMEOUT for the terminal to be reached
          const elapsedBeforeTerminal = prefix.length * POLL_INTERVAL;
          if (elapsedBeforeTerminal < POLL_TIMEOUT) {
            if (terminal === 'successful') {
              expect(result.outcome).toBe('success');
            } else {
              expect(result.outcome).toBe('failure');
            }
          } else {
            // Too many continuable statuses — should timeout before reaching terminal
            expect(result.outcome).toBe('timeout');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns timeout when only continuable statuses for >= 600 seconds (Req 10.5)', () => {
    // 600 / 15 = 40 polls needed to reach timeout
    const minPollsForTimeout = Math.ceil(POLL_TIMEOUT / POLL_INTERVAL);

    fc.assert(
      fc.property(
        fc.array(continuableStatusArb, { minLength: minPollsForTimeout, maxLength: minPollsForTimeout + 10 }),
        (sequence) => {
          const result = pollAwxJob(sequence);
          expect(result.outcome).toBe('timeout');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any arbitrary status sequence, outcome is always success, failure, or timeout', () => {
    fc.assert(
      fc.property(
        fc.array(awxStatusArb, { minLength: 0, maxLength: 50 }),
        (sequence) => {
          const result = pollAwxJob(sequence);
          expect(['success', 'failure', 'timeout']).toContain(result.outcome);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('first terminal status in sequence determines the outcome (Req 10.3, 10.4)', () => {
    fc.assert(
      fc.property(
        fc.array(continuableStatusArb, { minLength: 0, maxLength: 20 }).chain((prefix) =>
          fc.oneof(terminalSuccessArb, terminalFailureArb).chain((firstTerminal) =>
            fc.array(awxStatusArb, { minLength: 0, maxLength: 10 }).map((suffix) => ({
              prefix,
              firstTerminal,
              sequence: [...prefix, firstTerminal, ...suffix],
            })),
          ),
        ),
        ({ prefix, firstTerminal, sequence }) => {
          const elapsedBeforeTerminal = prefix.length * POLL_INTERVAL;
          if (elapsedBeforeTerminal >= POLL_TIMEOUT) {
            // Timeout before reaching terminal
            const result = pollAwxJob(sequence);
            expect(result.outcome).toBe('timeout');
            return;
          }

          const result = pollAwxJob(sequence);
          if (firstTerminal === 'successful') {
            expect(result.outcome).toBe('success');
          } else {
            expect(result.outcome).toBe('failure');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
