# Contributing

Thanks for helping improve port-reclaim.

## Development

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Run `npm test` before opening a pull request.

Keep changes focused, preserve cross-platform behavior, and add a test for new parsing or resolution logic. Do not commit `dist/` or `node_modules/`.

## Pull Requests

Describe the user-visible behavior, affected operating systems, and validation performed. Changes that terminate processes must include tests covering the safe and refusal paths.

## Reporting Security Issues

Do not disclose an unpatched security issue in a public issue. Follow [SECURITY.md](SECURITY.md).
