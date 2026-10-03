# Contributing

Thanks for helping improve port-reclaim.

## Development

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Run `npm test` before opening a pull request.

Keep changes focused, preserve cross-platform behavior, and add a test for new parsing or resolution logic. Do not commit `dist/` or `node_modules/`.

### Adding a test file

The `test` script lists every compiled test file explicitly:

```json
"test": "npm run build && node --test dist/tests/process.test.js dist/tests/args.test.js …"
```

That is deliberate — npm scripts do not expand globs on Windows — but it means a new
`tests/your-file.test.ts` that is not added to the list **is never executed**, locally or in CI,
and nothing will warn you. Add it to `package.json` in the same commit as the test.

### Platform rules

- **One OS call per port.** Discovery must not spawn a process per PID. A cold
  `powershell.exe` start costs roughly 0.7s against the product's two-second budget
  ([PRD §5.3](PRD.md)); `netstat`/`lsof` decides what is on a port and a single batched lookup
  fetches the names of every PID found.
- **Never let an OS failure look like an empty result.** Distinguish "ran and found nothing"
  from "could not run". A mistyped PowerShell cmdlet name was swallowed this way and shipped
  broken for a full release.
- **Preserve the safety tiers.** Refusals (Docker, OS PIDs 0–4) survive `--yes`; the
  always-prompt data-service list does not. A process holding any protected port is skipped.

## Releases

Releases are cut from git tags and published by GitHub Actions through npm trusted publishing.
There is no token to configure and nothing to publish by hand:

1. Update [CHANGELOG.md](CHANGELOG.md) and bump `version` in `package.json`.
2. `git push origin main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The Release workflow runs the test suite, publishes to npm with provenance, then opens the
   matching GitHub Release using that version's `CHANGELOG.md` section as the notes.

Keep the changelog section header in `## [X.Y.Z]` form — the workflow matches on it, and falls
back to generated commit notes if no section matches. A version number can never be reused; if a
publish fails partway, ship the next patch version.

To create or refresh the GitHub Release for a tag that is already pushed — an older version, or
one whose release was edited — run **Release → Run workflow** from the Actions tab and pass the
tag. That path only touches GitHub; it never re-publishes to npm.

## Pull Requests

Describe the user-visible behavior, affected operating systems, and validation performed. Changes that terminate processes must include tests covering the safe and refusal paths.

## Reporting Security Issues

Do not disclose an unpatched security issue in a public issue. Follow [SECURITY.md](SECURITY.md).
