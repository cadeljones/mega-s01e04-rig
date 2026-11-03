# Manual digest preview

The preview is one self-contained HTML file at the site's root `index.html`. It uses only
the sample night `runs/2026-10-28.jsonl`. Never commit the export, print it in logs, or attach
it to an issue or chat. See ADR 0003: the public marker must be removed after review.

## Before publication

Obtain approval for public publication and the repository configuration first. An approved
administrator must select **GitHub Actions** as the Pages source, configure the `github-pages`
environment (including any review/branch protections), and add the repository Actions secret
`LANE_MARKER`. The workflow does not enable Pages or create secrets. Do not duplicate this
secret as an environment secret: the workflow expects the repository secret.

The workflow must be on the default branch before GitHub exposes manual dispatch. Run only
a reviewed ref containing the completed digest work. Pushing commits never publishes a preview.
Node 22 and pnpm 8.11.0 are pinned for the workspace's compatibility requirements; installation
uses the frozen lockfile, followed by tests and type checking. Actions are pinned to commit SHAs.
The official `configure-pages` action checks that the site exists before building, with
`enablement: false`. With no static-site generator configured, it reads site metadata and
exports Pages metadata; it does not enable Pages, change its source, or reset deployments.

## Publish after approval

```sh
gh workflow run preview.yml --repo cadeljones/mega-s01e04-rig --ref main -f include_marker=true
gh run list --repo cadeljones/mega-s01e04-rig --workflow preview.yml --limit 5
gh run watch RUN_ID --repo cadeljones/mega-s01e04-rig --exit-status
```

`include_marker` is the only workflow input: boolean, required, default `true`. When true,
`LANE_MARKER` comes from the repository secret; a missing/empty value stops the export before
upload or deployment, without printing the value. When false, the export process receives an
explicitly empty `LANE_MARKER`; no `.env` is loaded by this export server.

Use the deployment environment's URL (normally
`https://cadeljones.github.io/mega-s01e04-rig/`). Every run replaces the root `index.html` at that
same URL. Check the page, then send the URL and plan issues to the reviewer through the course
claim. Preparing or running this workflow alone does not complete issue #7: it remains open
until the link and issues have actually been submitted.

## Remove the marker after review

After approval for this replacement, run the same reviewed workflow with the input false:

```sh
gh workflow run preview.yml --repo cadeljones/mega-s01e04-rig --ref main -f include_marker=false
```

Wait for success and verify the **same public URL** now says `no marker set`. Deleting an Actions
artifact does not remove the deployed Pages copy. Cleanup needs this second deployment.

The workflow serializes deployments without canceling an active run. A temporary Pages artifact
is necessary for deployment; it has a one-day fallback retention. After deployment, an
`always()` step deletes **only** the artifact ID returned by this run's upload action (the
official `artifact_id` output), even if deployment fails. `actions: write` is solely for that
DELETE request. Cleanup errors fail the job; inspect them and remove that specific artifact
with approval before considering cleanup complete. Hard cancellation, runner loss, or an upload
that fails before returning its ID can prevent deletion; retention is a fallback, not immediate
erasure. Hosted-runner files are also removed in an `always()` step. Public viewers can save
copies, and browser/CDN caches may outlive replacement; no workflow can revoke those copies.

## Deployment failure investigation (3 November 2026)

Read-only checks of runs `41668715821` and `41670663009` established:

- The first deployment progressed from `deployment_queued` to `updating_pages`, stayed there
  until the action's ten-minute timeout, then was explicitly cancelled by `deploy-pages`.
- Both runs sent `pages_build_version: ae93230280683ce78178268b4b8e7efbbe301711`, but different
  artifact IDs (`13247251357` and `13247507858`). Both logged that SHA as the deployment ID.
  The second run's first status poll immediately reported `Deployment cancelled.`
- The Pages-specific status endpoint still returned `deployment_cancelled` for that ID.
  Both runs' artifact lists were empty after cleanup. The Pages configuration endpoint
  reported `build_type: workflow` and the expected HTTPS URL.

The pinned [deploy action's source](https://github.com/actions/deploy-pages/tree/d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e/src/internal)
uses `GITHUB_SHA` as the build version, polls the returned deployment ID (falling back to the
build version), and explicitly cancels on timeout. This supports the hypothesis that the
second request observed cancelled state associated with the same SHA. It does **not** prove
the server's internal reuse rules or explain the original stall. Historical upstream reports
([#22](https://github.com/actions/deploy-pages/issues/22),
[#406](https://github.com/actions/deploy-pages/issues/406)) describe similar backend stalls;
they are not evidence of a confirmed GitHub incident at the time of these runs.

The missing `configure-pages` action is not an established cause: the site already exists in
Actions mode, and that action's non-enabling path only reads site metadata. Adding the official
preflight follows the static-site starter workflow and catches missing-site configuration
earlier; it is **not** a claimed fix for stuck/cancelled deployments.

Do not blindly rerun the cancelled SHA or falsify `GITHUB_SHA` to force a different deployment.
Before requesting another publication approval, inspect the existing state with read-only
commands (substitute the actual SHA/run ID):

```sh
gh api repos/cadeljones/mega-s01e04-rig/pages
gh api repos/cadeljones/mega-s01e04-rig/pages/deployments/SHA
gh api repos/cadeljones/mega-s01e04-rig/actions/runs/RUN_ID/artifacts
gh run view RUN_ID --repo cadeljones/mega-s01e04-rig --log-failed
```

A newly reviewed commit supplies a new build version, but is not a guaranteed remedy for a
Pages backend stall. If a future approved attempt also stalls, retain the run IDs, deployment
ID and timestamps for GitHub Support rather than repeatedly publishing. Increasing the input
timeout is not a remedy: the pinned deploy action caps it at ten minutes. Do not change Pages
settings, remove deployments, or rerun publication without separate approval. After any
successful marked or unmarked deployment, verify the actual public page, not only action status.

## Local export (no publication)

Use Node 22 and the installed project dependencies. From the repository root, this command starts
the real HTTP app with `rig.json`, binds only to loopback, and skips the heartbeat. The output
directory is outside the checkout. It never prints the HTML or marker. `LANE_MARKER` is read
from the local `.env`; the unmarked variant is described below the command.

```sh
(
  set -eu
  preview_dir="$(mktemp -d "${TMPDIR:-/tmp}/rig-preview.XXXXXX")"
  node --env-file=.env --import tsx --input-type=module -e '
    import { serve } from "@hono/node-server";
    import { createApp } from "./src/app.tsx";
    serve({ fetch: createApp().fetch, hostname: "127.0.0.1", port: 8787 });
  ' > "$preview_dir/server.log" 2>&1 &
  server_pid=$!
  trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT
  curl --fail --silent --show-error --output /dev/null \
    --retry 20 --retry-delay 1 --retry-connrefused --retry-all-errors \
    --retry-max-time 45 --max-time 2 http://localhost:8787/health
  curl --fail --silent --show-error --max-time 10 \
    http://localhost:8787/digest/2026-10-28 > "$preview_dir/index.html"
  printf 'Local export: %s/index.html\n' "$preview_dir"
)
```

For an unmarked local export, replace `node --env-file=.env --import tsx` with
`LANE_MARKER='' node --import tsx` in that block. Ensure port 8787 is free before either export
(otherwise the request could reach another process). Keep the temporary directory private and
delete its `index.html` and `server.log` after use; never copy it into the repository.
