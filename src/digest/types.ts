export type RunStatus = 'ok' | 'retry' | 'fail';

/** Counts of valid log events, not counts of jobs or their final statuses. */
export type StatusCounts = {
  ok: number;
  retry: number;
  fail: number;
};

/** One job, aggregated in log file order (not timestamp order). */
export type DigestRow = {
  job: string;
  /** Owner from the job's last valid event; null is retained for display as —. */
  owner: string | null;
  /** All valid events for this job, including retries and failures. */
  runs: number;
  /** Number of valid events whose status is retry. */
  retries: number;
  lastStatus: RunStatus;
  /** True if any valid event failed, even if the last event succeeded. */
  hasFailure: boolean;
  /** Last supplied error string; later events without an error do not clear it. */
  lastError: string | null;
  /** Original timestamp strings from first/last events, with offsets unchanged. */
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  /** One row per job, ascending by job using string comparison, not locale order. */
  rows: DigestRow[];
  /** Nonblank lines with malformed JSON or invalid event fields; blanks are ignored. */
  badLines: number;
  /** Raw valid-event totals across all jobs; their sum equals the sum of row.runs. */
  counts: StatusCounts;
};

/**
 * Synchronously read runsDir/<night>.jsonl, where night is YYYY-MM-DD.
 * Return null only for a missing file; other I/O errors propagate.
 * An empty (or blank-only) file returns a NightDigest with no rows and zero counts.
 * Invalid lines increment badLines without stopping aggregation; valid events have
 * at, job, status, owner, and optionally a string error, as specified in plan.md.
 * A job with no supplied error has lastError: null.
 *
 * Implementation: src/digest/read-night.ts exports readNight with this type.
 * Page and JSON consumers import that implementation, not a runtime stub here.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
