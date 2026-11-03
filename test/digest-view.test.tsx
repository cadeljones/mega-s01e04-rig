import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { DigestRow, NightDigest } from '../src/digest/types.js';
import { Digest } from '../src/views/digest.js';
import { Layout } from '../src/views/layout.js';

const row: DigestRow = {
  job: 'alpha', owner: null, runs: 5, retries: 3, lastStatus: 'ok',
  hasFailure: true, lastError: null,
  firstAt: '2026-10-28T01:00:00+05:30', lastAt: '2026-10-28T01:30:00+05:30',
};

async function render(rows: DigestRow[], badLines = 0) {
  const digest: NightDigest = {
    night: '2026-10-28', rows, badLines, counts: { ok: 0, retry: 0, fail: 0 },
  };
  const app = new Hono();
  app.get('/', (c) => c.html(
    <Layout title="digest" lane={{ id: 'lane-test', marker: 'VIEW-TEST' }}>
      <Digest digest={digest} />
    </Layout>,
  ));
  return (await app.request('/')).text();
}

describe('digest view', () => {
  it('renders accessible columns, reader order, missing values, and original timestamps', async () => {
    const html = await render([row, { ...row, job: 'zebra', owner: 'rook' }]);
    expect(html).toContain('VIEW-TEST');
    expect(html).toContain('<caption>jobs for 2026-10-28</caption>');
    for (const column of ['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first timestamp', 'last timestamp']) {
      expect(html).toContain(`<th scope="col">${column}</th>`);
    }
    expect(html.indexOf('<th scope="row">alpha')).toBeLessThan(html.indexOf('<th scope="row">zebra'));
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('<td>rook</td>');
    for (const at of [row.firstAt, row.lastAt]) {
      expect(html).toContain(`<time datetime="${at}">${at}</time>`);
    }
    expect(html).not.toContain('<script');
  });

  it('marks high retries and a historical failure even after recovery', async () => {
    const html = await render([row]);
    expect(html).toContain('<strong class="warn">3 (high retries)</strong>');
    expect(html).toContain('<strong class="warn">ok (failure during night)</strong>');
  });

  it('does not warn for fewer than three retries without a failure', async () => {
    const html = await render([{ ...row, retries: 2, hasFailure: false }]);
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('<td>ok</td>');
    expect(html).not.toContain('class="warn"');
  });

  it('keeps log text escaped and complete', async () => {
    const html = await render([{ ...row, job: '<script>job</script>', lastError: '<bad> & details' }]);
    expect(html).toContain('&lt;script&gt;job&lt;/script&gt;');
    expect(html).toContain('&lt;bad&gt; &amp; details');
    expect(html).not.toContain('<script>');
  });

  it('renders an empty night and makes skipped bad lines visible', async () => {
    const html = await render([], 2);
    expect(html).toContain('nothing ran');
    expect(html).toContain('<p class="warn">bad lines: 2 (skipped)</p>');
    expect(html).not.toContain('<table>');
  });
});
