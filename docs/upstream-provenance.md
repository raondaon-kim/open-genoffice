# Upstream provenance and maintenance

## Source relationship

This repository is a derivative of
[`genspark-ai/genoffice`](https://github.com/genspark-ai/genoffice). The
provider-routing work starts from upstream commit
`4da673d4dfa994bd0b4a9bc43430e4a058a17c61` (`Sync snapshot (2026-08-03)
(#6)`). The public repository begins with a sanitized source snapshot so that
private preparation history and the separately licensed upstream `ee/` subtree
are not redistributed. `MODIFICATIONS.md` records the material differences.

This record documents source ancestry. It does not grant trademark rights or
change the terms of any separately licensed directory or hosted service.

## Upstream integration policy

1. Fetch `upstream/main` and record the exact new commit.
2. Create a temporary `integration/upstream-YYYY-MM-DD` branch.
3. Compare and import only Apache-2.0-compatible upstream changes; never import
   the separately licensed `ee/` subtree.
4. Review conflicts around provider routing, encrypted secret storage, IPC,
   packaging identity, update isolation, and Genspark integrations.
5. Run formatting, lint, typecheck, tests, builds, license checks, and packaged
   smoke tests.
6. Verify that renderers cannot obtain raw keys, unavailable routes do not fall
   back silently, existing document routes remain sticky, and new documents
   copy the current global default.
7. Perform an opt-in live provider smoke test with a temporary restricted key.
   Never put that key in Git or CI.

Upstream source updates are not binary updates for this derivative. The
derivative's signing and updater architecture remain separate release
decisions.

## Bundled rhwp studio (Hangul editor)

The Hangul module embeds the rhwp studio UI from
[`edwardkim/rhwp`](https://github.com/edwardkim/rhwp) (MIT). It is not
vendored: `tools/build-hwp-studio.mjs` sparse-clones the upstream tag whose
version equals the installed `@rhwp/core` (pinned exactly in
`apps/hwp/package.json`), drops in that package's WASM, removes the PWA
plugin, disables CDN web fonts (`RHWP_DISABLE_EXTERNAL_WEBFONTS=1`; the
Hamchorom CDN is licensed for non-commercial use only), and builds into
`apps/hwp/dist/studio/` (gitignored). electron-builder copies that directory
to `resources/modules/hwp-studio`, and the hwp main process serves it under
`/rhwp/` on its loopback origin. The studio's own third-party notices are
assembled into `dist/studio/THIRD-PARTY.md` and merged into the installer's
notices.

To move to a new rhwp release: set `@rhwp/core` and `@rhwp/editor` to the
same exact version in `apps/hwp/package.json`, run `npm install`, then
`npm run build:hwp-studio -- --force` and `npm run fetch:rhwp-cli -- --force`,
and open a `.hwp` and a `.hwpx` with the network disconnected. The SDK, the
studio, the WASM and the CLI must share one version; mixed versions fall back
to the SDK's legacy handshake and are not supported here.

## Packaged native helpers

electron-builder copies the root `package.json` `dependencies` into
`app.asar` automatically. Native helper binaries are deliberately not shipped
that way: the sheets xlsx sidecar, the HwpForge MCP binary (`@hwpforge/mcp`,
declared in `apps/hwp`) and the rhwp CLI (fetched from the pinned upstream
release by `tools/fetch-rhwp-cli.mjs` and verified against its
`SHA256SUMS.txt`) are listed as platform `extraResources` in
`apps/shell/electron-builder.cjs`, and the main process spawns them directly
from `resources/native/`. electron-builder only warns about a missing
`extraResources` source, so the `beforePack` hook
(`apps/shell/build/verify-extra-resources.js`) fails the build when any source
for the platform being packaged — module `out` trees, the studio, a native
binary — is missing or an empty directory.

## Codex app-server bridge (from upstream)

`packages/ai-provider/src/codex-app-server.ts`, `watchdog.ts`, the stream-callback
subset of `protocols/shared.ts` and the tests `codex-app-server.test.ts` /
`codex-stdout-lines.test.ts` are ported from `genspark-ai/genoffice`
`676bf4d5` (Apache-2.0). Fork changes: binary resolution prefers a custom path
(which must exist), then the bundled app-server, the desktop install, the VS
Code extension's CLI and PATH; the standalone `codex-app-server` is launched
without the CLI subcommand; the client exposes `withCodexRpc` for the account
RPCs in `codex-account.ts`. The app ships the official Codex app-server
(`openai/codex` `rust-v0.159.3`, Apache-2.0) as `resources/native/codex-app-server[.exe]`,
fetched and SHA-256-verified by `tools/fetch-codex.mjs`.
