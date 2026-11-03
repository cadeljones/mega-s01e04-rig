import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDigestJson } from '../src/digest/json.js';
import type { NightDigest, ReadNight } from '../src/digest/types.js';

const { readNight } = vi.hoisted(() => ({ readNight: vi.fn<ReadNight>() }));

vi.mock('../src/digest/read-night.js', () => ({ readNight }));

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '/unused/mock-runs',
};

function createApp() {
  const app = new Hono();
  registerDigestJson(app, config);
  return app;
}

describe('digest JSON registration', () => {
  beforeEach(() => readNight.mockReset());

  it('returns the reader envelope without aggregating or reordering rows', async () => {
    const row = {
      job: 'z-job',
      owner: null,
      runs: 4,
      retries: 3,
      lastStatus: 'ok' as const,
      hasFailure: false,
      lastError: 'retry reason',
      firstAt: '2026-10-28T01:00:00+01:00',
      lastAt: '2026-10-28T02:00:00+01:00',
    };
    const digest: NightDigest = {
      night: '2026-10-28',
      rows: [row, { ...row, job: 'a-job' }],
      badLines: 1,
      counts: { ok: 2, retry: 6, fail: 0 },
    };
    readNight.mockReturnValue(digest);

    const res = await createApp().request('/api/digest/2026-10-28');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(digest);
    expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, '2026-10-28');
  });

  it('returns an empty night as a successful envelope', async () => {
    const digest: NightDigest = {
      night: '2026-10-29',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    };
    readNight.mockReturnValue(digest);

    const res = await createApp().request('/api/digest/2026-10-29');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(digest);
  });

  it.each(['2026-10-30', 'invalid-night'])('returns JSON 404 when the reader rejects %s', async (night) => {
    readNight.mockReturnValue(null);

    const res = await createApp().request(`/api/digest/${night}`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Night not found' });
    expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, night);
  });
});
