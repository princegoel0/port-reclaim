# Changelog

All notable changes to `port-reclaim` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) while treating `0.x` minor
bumps as potentially breaking for the programmatic API.

## [0.4.1] - 2026-10-02

### Added

- `FORCE_COLOR=1` forces coloured output when stdout is not a terminal, for CI logs and
  recorded demos. `NO_COLOR` still takes precedence.

### Documentation

- A recorded demo GIF at the top of the README. Every frame is real tool output captured
  from the CLI, not a mock-up.
- This changelog, and the contributing rules that keep the test suite and the latency budget
  from silently regressing.

## [0.4.0] - 2026-10-02

### Added

- `--match REGEX` (`-m`) reclaims every port held by a process whose command name matches,
  without naming ports. A process listening on several ports is terminated once and
  reported as `Released ports 3000, 5173 from …`. The safety model is unchanged: refusals
  still block, data services still prompt, a process holding any protected port is skipped,
  an invalid expression exits `2`, and `--match` cannot be combined with port arguments.
- Coloured output: green for releases, red for refusals and errors, yellow for prompts,
  dim for process details. Colour is disabled automatically when output is redirected, and
  can be turned off with `--no-color` or the `NO_COLOR` environment variable. Styling is
  ~30 lines of raw ANSI, so the package keeps a single runtime dependency.
- `ProcessRunner.discoverListening(regex)` for name-based selection, and a `ports` array on
  discovered processes.
- Data services (`postgres`, `postmaster`, `mysqld`, `mariadbd`, `mongod`, `redis-server`,
  `memcached`, `etcd`) are never auto-killed. Previously the working-directory check ran
  before any name check, so a database started from inside the project looked exactly like a
  stale dev server and was killed silently. They now always confirm; `--yes` still overrides.

### Changed

- `--yes` is documented as never overriding a refusal, so the protection tiers are explicit.

## [0.3.0] - 2026-10-02

### Performance

- Discovery no longer starts one `powershell.exe` per query. On Windows a free port cost
  ~1.0s and a busy port ~1.3s, because `netstat`-equivalent lookups ran three times; `netstat`
  now decides whether anything is on the port and PowerShell is started at most once, for the
  names of the processes actually found. On Unix, per-PID `ps` calls were batched into one.
- Measured on Windows 11: free port ~0.10s (was ~1.0s), identifying a busy port ~0.41s
  (was ~1.26s), a full single-process reclaim ~0.59s. This is the first release with the
  PRD's `< 2 second` goal actually verified.

### Fixed

- **Windows UDP discovery never worked.** It called `Get-NetUDPConnection`, which is not a
  cmdlet (`Get-NetUDPEndpoint` is), and `SilentlyContinue` swallowed the failure — so UDP
  listeners were silently invisible on Windows.
- **Windows never showed a process uptime.** Age was computed as `UtcNow - StartTime`, but
  `Get-Process StartTime` is local time, so the value was negative and got discarded.
- A port held by a process the current user cannot see — another user's or an elevated
  process — was reported as free and exited `0`, so a chained `port-reclaim 3000 && next dev`
  still failed. The port is now verified by briefly binding it, and an unclaimable port is
  reported as such with guidance.
- Operating-system PIDs 0–4 (`System`/HTTP.sys, `systemd`) are refused rather than killed,
  generalising the previous Docker-only refusal into a `refusal` reason on any discovered
  process.

### Removed

- `ProcessRunner` gained a required `probe()` method, and `PortProcess.docker` became the
  more general `refusal` — both breaking for programmatic consumers. The unused
  `parseWindowsPids` export was removed.

## [0.2.1] - 2026-09-22

### Documentation

- README gained an options table, a configuration section, a programmatic-usage section, and
  a "why port-reclaim" comparison.
- Package metadata retargeted at the queries developers actually type: `kill-port`,
  `port-killer`, `eaddrinuse`, `port-already-in-use`, `dev-server`.

## [0.2.0] - 2026-09-22

### Added

- Multiple ports in one invocation: `port-reclaim 3000 5173 8080`.
- `--list` / `-l` reports what holds a port — name, PID, working directory, uptime, protocol —
  without terminating anything.
- `--yes` / `-y` (and `--force`) to terminate processes from other directories without prompting.
- Configuration so a bare `port-reclaim` works: a `port-reclaim` key in `package.json`
  (`ports`, `ignore`) and a `.reclaimignore` file protecting listed ports.
- UDP listener discovery, process uptime, and Docker detection.
- A programmatic API (`port-reclaim` as a library) and generated TypeScript declarations.
- Exit codes: `0` free or released, `1` still in use or declined, `2` invalid input.

### Fixed

- **`port-reclaim` reported success without freeing the port on Windows.** `taskkill` was
  called without `/F`, which cannot end console processes such as Node dev servers, and the
  command's failure was being swallowed.
- The `netstat` fallback matched ports by suffix, so querying port 3000 matched a listener on
  13000.

## [0.1.0] - 2026-09-20

### Added

- Initial release: identify the process holding a port and reclaim it, automatically when it
  belongs to the current project and after confirmation otherwise. Cross-platform for macOS,
  Linux, and Windows.

[0.4.1]: https://github.com/princegoel0/port-reclaim/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/princegoel0/port-reclaim/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/princegoel0/port-reclaim/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/princegoel0/port-reclaim/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/princegoel0/port-reclaim/compare/ba220dc...v0.2.0
[0.1.0]: https://github.com/princegoel0/port-reclaim/commit/ba220dc
