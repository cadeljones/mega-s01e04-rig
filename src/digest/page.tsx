import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { lane } from '../lane.js';
import { Digest } from '../views/digest.js';
import { Layout } from '../views/layout.js';
import { readNight } from './read-night.js';

export function registerDigestPage(app: Hono, config: RigConfig): void {
  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const digest = /^\d{4}-\d{2}-\d{2}$/.test(night)
      ? readNight(config.runsDir, night)
      : null;

    if (digest === null) {
      return c.html(
        <Layout title="digest not found" lane={lane()}>
          <h1>digest not found</h1>
          <p>no run log for {night}</p>
        </Layout>,
        404,
      );
    }

    return c.html(
      <Layout title={`digest · ${night}`} lane={lane()}>
        <Digest digest={digest} />
      </Layout>,
    );
  });
}
