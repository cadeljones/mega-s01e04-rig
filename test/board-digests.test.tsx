import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadNight } from '../src/digest/types.js';

vi.mock('../src/digest/read-night.js', () => ({ readNight: vi.fn() }));

import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/read-night.js';
import { readStatus } from '../src/status.js';

const reader = vi.mocked<ReadNight>(readNight);
const dirs: string[] = [];

function fixtureConfig() {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
  dirs.push(runsDir);
  for (const night of ['2026-10-27', '2026-10-28']) {
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
  }
  return { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  reader.mockReset();
});

describe('board digest links', () => {
  it('preserves nights and uses event counts supplied by the shared reader', async () => {
    const config = fixtureConfig();
    reader.mockImplementation((_dir, night) => ({
      night,
      rows: [],
      badLines: 1,
      counts: night === '2026-10-28' ? { ok: 4, retry: 7, fail: 2 } : { ok: 0, retry: 0, fail: 0 },
    }));

    const status = readStatus(config);
    expect(status.nights).toEqual(['2026-10-28', '2026-10-27']);
    expect(status.nightCounts['2026-10-28']).toEqual({ ok: 4, retry: 7, fail: 2 });
    expect(reader).toHaveBeenCalledWith(config.runsDir, '2026-10-28');
    expect(reader).toHaveBeenCalledWith(config.runsDir, '2026-10-27');

    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(html).toContain('ok 4 / retry 7 / fail 2');
    expect(html).toContain('ok 0 / retry 0 / fail 0');
    expect(html).toContain('valid log events, not final job statuses');
  });

  it('shows missing counts rather than inventing zeros when a listed file disappears', async () => {
    reader.mockReturnValue(null);
    const res = await createApp(fixtureConfig()).request('/');
    expect(await res.text()).toContain('ok — / retry — / fail —');
  });

  it('keeps the empty-directory message without reading a night', async () => {
    const config = fixtureConfig();
    config.runsDir = join(config.runsDir, 'missing');
    const res = await createApp(config).request('/');
    expect(await res.text()).toContain('nothing in runs/');
    expect(reader).not.toHaveBeenCalled();
  });
});
