import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-29T01:30:00+01:00',
  job: 'fixtures/refresh',
  status: 'ok',
  owner: 'rook',
};

describe('readNight fixtures', () => {
  it('reads five jobs and one bad line without changing timestamp offsets', () => {
    const digest = readNight(new URL('../runs/', import.meta.url).pathname, night);
    expect(digest).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', hasFailure: false, lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', hasFailure: false, lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1,
          lastStatus: 'ok', hasFailure: false, lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'fail', hasFailure: true, lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'ok', hasFailure: false, lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('reads the other fixture as seven successful events across four jobs', () => {
    const digest = readNight(new URL('../runs/', import.meta.url).pathname, '2026-10-27');
    expect(digest?.rows).toHaveLength(4);
    expect(digest?.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
    expect(digest?.badLines).toBe(0);
  });
});

describe('readNight', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeEvents(events: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
  }

  it('returns null for a missing file', () => {
    expect(readNight(runsDir, night)).toBeNull();
  });

  it.each(['', ' \n\t\r\n  '])('returns an empty digest for empty or blank-only input (%j)', (contents) => {
    writeFileSync(join(runsDir, `${night}.jsonl`), contents);
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-1-28', '2026-10-28/..', '2026-10-28\n', ''])
    ('rejects non-date-shaped night input (%j)', (invalidNight) => {
      writeEvents([event]);
      expect(readNight(runsDir, invalidNight)).toBeNull();
    });

  it('propagates I/O errors other than a missing file', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });

  it('counts malformed JSON and invalid fields, ignoring blank lines and continuing', () => {
    const invalid: unknown[] = [
      null, [], 1, true, 'event', {},
      { ...event, at: null }, { ...event, job: 4 },
      { ...event, status: 'unknown' }, { ...event, owner: false },
      { ...event, error: null }, { ...event, error: 5 },
      { job: event.job, status: 'ok', owner: null },
      { at: event.at, status: 'ok', owner: null },
      { at: event.at, job: event.job, owner: null },
      { at: event.at, job: event.job, status: 'ok' },
    ];
    const lines = invalid.map((value) => JSON.stringify(value));
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      JSON.stringify(event), '\r', '{bad json', ...lines, '  ',
      JSON.stringify({ ...event, status: 'retry', owner: null, extra: true }),
    ].join('\r\n'));
    const digest = readNight(runsDir, night);
    expect(digest?.badLines).toBe(invalid.length + 1);
    expect(digest?.counts).toEqual({ ok: 1, retry: 1, fail: 0 });
    expect(digest?.rows[0]).toMatchObject({ runs: 2, retries: 1, owner: null });
  });

  it('aggregates in file order, retains failures and the latest supplied error, and keeps null owners', () => {
    const firstAt = '2026-10-29T03:00:00+05:30';
    const lastAt = '2026-10-28T01:00:00-07:00';
    writeEvents([
      { ...event, at: firstAt, status: 'fail', error: 'first error' },
      { ...event, status: 'retry', error: 'latest error' },
      { ...event, at: lastAt, owner: null },
    ]);
    expect(readNight(runsDir, night)).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{
        job: event.job, owner: null, runs: 3, retries: 1,
        lastStatus: 'ok', hasFailure: true, lastError: 'latest error', firstAt, lastAt,
      }],
    });
  });

  it('treats an empty error string as the latest supplied error', () => {
    writeEvents([{ ...event, error: 'old' }, { ...event, error: '' }, event]);
    expect(readNight(runsDir, night)?.rows[0].lastError).toBe('');
  });

  it('sorts jobs using binary string order and safely handles object-like job names', () => {
    writeEvents(['ä', 'z', 'a', '__proto__', 'Z', 'constructor'].map((job) => ({ ...event, job })));
    const digest = readNight(runsDir, night);
    expect(digest?.rows.map((row) => row.job)).toEqual(['Z', '__proto__', 'a', 'constructor', 'z', 'ä']);
    expect(digest?.counts).toEqual({ ok: 6, retry: 0, fail: 0 });
    expect(digest?.rows.reduce((total, row) => total + row.runs, 0)).toBe(6);
  });
});
