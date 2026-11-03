import type { NightDigest } from '../digest/types.js';

export function Digest({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      {digest.badLines > 0 && (
        <p class="warn">bad lines: {digest.badLines} (skipped)</p>
      )}
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <caption>jobs for {digest.night}</caption>
          <thead>
            <tr>
              <th scope="col">job</th>
              <th scope="col">owner</th>
              <th scope="col">runs</th>
              <th scope="col">retries</th>
              <th scope="col">last status</th>
              <th scope="col">last error</th>
              <th scope="col">first timestamp</th>
              <th scope="col">last timestamp</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr>
                <th scope="row">{row.job}</th>
                <td>{row.owner ?? '—'}</td>
                <td>{row.runs}</td>
                <td>
                  {row.retries >= 3 ? (
                    <strong class="warn">{row.retries} (high retries)</strong>
                  ) : row.retries}
                </td>
                <td>
                  {row.hasFailure ? (
                    <strong class="warn">{row.lastStatus} (failure during night)</strong>
                  ) : row.lastStatus}
                </td>
                <td>{row.lastError ?? '—'}</td>
                <td><time datetime={row.firstAt}>{row.firstAt}</time></td>
                <td><time datetime={row.lastAt}>{row.lastAt}</time></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
