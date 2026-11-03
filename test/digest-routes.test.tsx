import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T23:10:00-04:00';
const lastAt = '2026-10-29T05:20:00+02:00';

function event(job: string, status: 'ok' | 'retry' | 'fail', options: {
  at?: string;
  owner?: string | null;
  error?: string;
} = {}) {
  return JSON.stringify({ at: firstAt, job, status, owner: 'rook', ...options });
}

function text(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Only the table's first cell (job) and row text are structural contracts.
// Do not couple these integration tests to view classes or exact markup.
function tableRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((match) => {
    const cell = match[1].match(/<td\b[^>]*>([\s\S]*?)<\/td>/i);
    return cell ? [{ job: text(cell[1]), text: text(match[1]) }] : [];
  });
}

describe('digest routes', () => {
  let runsDir: string;
  let config: RigConfig;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    config = {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    };
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeNight(lines: string[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\n'));
  }

  it('returns the NightDigest envelope with aggregated rows and raw event counts', async () => {
    writeNight([
      event('zulu', 'ok'),
      event('alpha', 'fail', { error: 'connection lost' }),
      event('alpha', 'retry'),
      event('alpha', 'retry'),
      event('alpha', 'retry'),
      event('alpha', 'ok', { at: lastAt, owner: null }),
      event('Bravo', 'ok'),
    ]);

    const response = await createApp(config).request(`/api/digest/${night}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      night,
      rows: [
        {
          job: 'Bravo', owner: 'rook', runs: 1, retries: 0, lastStatus: 'ok',
          hasFailure: false, lastError: null, firstAt, lastAt: firstAt,
        },
        {
          job: 'alpha', owner: null, runs: 5, retries: 3, lastStatus: 'ok',
          hasFailure: true, lastError: 'connection lost', firstAt, lastAt,
        },
        {
          job: 'zulu', owner: 'rook', runs: 1, retries: 0, lastStatus: 'ok',
          hasFailure: false, lastError: null, firstAt, lastAt: firstAt,
        },
      ],
      badLines: 0,
      counts: { ok: 3, retry: 3, fail: 1 },
    } satisfies NightDigest);
  });

  it.each(['/digest', '/api/digest'])('returns 404 for a missing night at %s', async (route) => {
    const response = await createApp(config).request(`${route}/${night}`);
    expect(response.status).toBe(404);
  });

  it.each(['', '\n  \n\t\n'])('renders an empty or blank-only night without inventing jobs (%j)', async (contents) => {
    writeNight([contents]);
    const app = createApp(config);
    const page = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const html = await page.text();
    expect(text(html).toLowerCase()).toContain('nothing ran');
    expect(tableRows(html)).toEqual([]);
    expect(await json.json()).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed and invalid lines without losing valid jobs on either route', async () => {
    writeNight([
      event('before', 'ok'),
      '{not json',
      '',
      JSON.stringify({ at: firstAt, job: 'invalid', status: 'unknown', owner: 'rook' }),
      event('after', 'fail', { error: 'disk full' }),
    ]);
    const app = createApp(config);
    const page = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const digest = await json.json() as NightDigest;
    expect(digest.badLines).toBe(2);
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 1 });
    expect(digest.rows.map((row) => row.job)).toEqual(['after', 'before']);
    const html = await page.text();
    expect(tableRows(html).map((row) => row.job)).toEqual(['after', 'before']);
    expect(text(html)).toMatch(/(?:2\s+bad\s+lines?|bad\s+lines?\s*:?\s*2)/i);
  });

  it('keeps HTML and JSON in string-sorted job order and shows missing owners and original offsets', async () => {
    writeNight([
      event('zulu', 'ok'),
      event('alpha', 'ok', { owner: null, at: lastAt }),
      event('Bravo', 'ok'),
    ]);
    const app = createApp(config);
    const page = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(json.status).toBe(200);
    const rows = tableRows(await page.text());
    const digest = await json.json() as NightDigest;
    expect(rows.map((row) => row.job)).toEqual(['Bravo', 'alpha', 'zulu']);
    expect(rows.map((row) => row.job)).toEqual(digest.rows.map((row) => row.job));
    expect(rows.find((row) => row.job === 'alpha')?.text).toContain('—');
    expect(rows.find((row) => row.job === 'alpha')?.text).toContain(lastAt);
    expect(rows.find((row) => row.job === 'zulu')?.text).toContain(firstAt);
  });

  it('flags three retries and any failure, even when the final status recovers to ok', async () => {
    writeNight([
      event('retried', 'retry'),
      event('retried', 'retry'),
      event('retried', 'retry'),
      event('retried', 'ok'),
      event('recovered', 'fail', { error: 'connection lost' }),
      event('recovered', 'ok'),
      event('failed', 'fail', { error: 'disk full' }),
    ]);
    const page = await createApp(config).request(`/digest/${night}`);
    expect(page.status).toBe(200);
    const rows = tableRows(await page.text());
    const retried = rows.find((row) => row.job === 'retried')?.text;
    expect(retried).toMatch(/3/);
    // Warning text must survive without depending on CSS or a particular tag.
    expect(retried).toMatch(/retr(?:y|ies)|⚠/i);
    const recovered = rows.find((row) => row.job === 'recovered')?.text;
    expect(recovered).toMatch(/fail|⚠/i);
    expect(recovered).toContain('ok');
    expect(recovered).toContain('connection lost');
    expect(rows.find((row) => row.job === 'failed')?.text).toContain('disk full');
  });

  it('escapes untrusted job, owner and error text in HTML while preserving JSON values', async () => {
    const job = '<script>alert("job")</script>';
    const owner = '<img src=x onerror=alert("owner")>';
    const error = '<svg onload=alert("error")>';
    writeNight([event(job, 'fail', { owner, error })]);
    const app = createApp(config);
    const page = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const html = await page.text();
    expect(html).not.toMatch(/<(?:script|img|svg)\b/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;svg');
    const digest = await json.json() as NightDigest;
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0]).toMatchObject({ job, owner, lastError: error });
  });
});
