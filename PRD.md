# PRD: Smart Port Reclaimer (`port-reclaim`)

## 1. Overview
### 1.1 The Problem
When developing locally (Node.js, Python, Ruby, etc.), servers frequently crash or are stopped improperly, leaving the underlying process holding onto the port (e.g., `EADDRINUSE :::3000`). To fix this, developers must manually identify the process ID (PID) using tools like `lsof` or `netstat` and explicitly kill it. This interrupts workflow multiple times a day.

### 1.2 The Solution
`port-reclaim` is a zero-configuration, cross-platform CLI tool that intelligently identifies and resolves port conflicts. Unlike brute-force "kill-port" tools, it determines *what* is running on the port. If the process belongs to the current project, it silently reclaims the port from it. If it belongs to a different project or system service, it prompts the user for confirmation before acting. The tool frees the port only; restarting the developer's server is the caller's job, which is why the CLI is designed to chain (`port-reclaim 3000 && next dev`).

## 2. Target Audience
* Backend Developers (Node.js, Python FastAPI/Django, Go)
* Frontend Developers (React/Next.js, Vue/Nuxt, Vite)
* Full-Stack Engineers running multiple local services

## 3. Product Goals & Metrics
* **Goal 1:** Eliminate the manual `lsof -i :PORT` -> `kill -9 PID` loop entirely.
* **Goal 2:** Provide a safe mechanism that prevents developers from accidentally killing essential system services or databases. Three tiers: absolute refusals (Docker, OS PIDs 0–4), an always-prompt list of data services that survives the same-directory shortcut, and the user's own `.reclaimignore` / `ignore` config.
* **Goal 3:** Seamless integration into existing NPM/Pip scripts.
* **Success Metric:** Time to resolve an `EADDRINUSE` error drops from ~45 seconds to < 2 seconds.
* **Measured (2026-10-02, Windows 11, Node 24):** answering "free" takes ~0.10s, identifying a busy port ~0.41s, and a full single-process reclaim ~0.59s. Metric met. The 0.2.1 implementation spent ~1.0s on a free port and ~1.3s on a busy one because discovery started PowerShell three times — see 5.3.

## 4. Core Features

### 4.1 Intelligent Process Identification (The "Smart" part)
* The tool must identify the PID holding the specified port.
* It must extract the **command name** (e.g., `node`, `python`, `docker`).
* It must determine the **Current Working Directory (CWD)** of the blocking process.

### 4.2 Context-Aware Resolution Strategy
* **Scenario A: Same Project Match:** If the blocking process's CWD matches the directory where `port-reclaim` is invoked, the tool assumes it is a stale process from the current project and **automatically kills it** (SIGTERM, falling back to SIGKILL).
* **Scenario B: Different Project / System Service:** If the CWD does *not* match, the tool pauses and displays an interactive prompt. The same happens for a recognised data service (`postgres`, `postmaster`, `mysqld`, `mariadbd`, `mongod`, `redis-server`, `memcached`, `etcd`) even when its CWD *does* match — a database started from inside a project directory otherwise looks exactly like a stale dev server, and `--yes` is the only way past that prompt.
  * *Prompt Example:* `Port 3000 is used by 'node' in '/users/dev/other-project'. Kill it? (y/N)`
* **Scenario C: Protected Process:** Docker processes (`docker-proxy`, `vpnkit`, Docker Desktop) and operating-system PIDs 0–4 (`System`/HTTP.sys on Windows, `systemd` and friends on Unix) are never signalled, even under `--yes`. The tool explains what to stop instead and exits `1`.

### 4.3 Cross-Platform Support
* Must work consistently across macOS, Linux, and Windows (WSL and native CMD/PowerShell).

### 4.4 CLI Integration
* Designed to be chained in package managers.
  * *NPM Example:* `"dev": "port-reclaim 3000 && next dev"`

## 5. Technical Requirements

### 5.1 Proposed Stack
* **Language:** Node.js (TypeScript) or Python. 
* **Key Libraries (Node.js Example):**
  * `find-process` or custom `lsof`/`netstat` parsing logic to get PIDs. *(shipped as custom parsing, one batched call per port.)*
  * `prompts` or `inquirer` for the interactive CLI confirmation. *(shipped with neither — `node:readline/promises` keeps the dependency count at one.)*
  * `chalk` or `kleur` for terminal styling. *(shipped as `src/style.ts`, ~30 lines of raw ANSI honouring `NO_COLOR`, `--no-color`, and redirected output.)*

### 5.2 Flow Logic
1. **Input:** `port-reclaim <PORT>`
2. **Scan:** Execute OS-level command (`lsof` on Unix, `netstat` on Windows) to find the PID using `<PORT>`.
3. **If no PID found:** Exit 0 (Success, port is free).
4. **If PID found:** Get process metadata (Name, CWD).
5. **Evaluate:**
   * `If ProcessCWD == CurrentExecutionCWD:` Terminate the PID -> Exit 0.
   * `Else:` Display Prompt.
     * `If User == Yes:` Terminate the PID -> Exit 0.
     * `If User == No:` Exit 1 (Failure, port remains blocked).

### 5.3 Performance Constraints

The success metric in section 3 is a budget, and on Windows almost all of it is process-spawn cost: one cold `powershell.exe` start is ~0.7s, while `netstat` returns in ~0.1s. Discovery must therefore stay batched — one `netstat`/`lsof` call to find the PIDs on a port, and at most one follow-up call for the names and uptimes of *all* those PIDs. Per-PID lookups multiply the budget and were the reason 0.2.1 spent ~1.3s before it had even decided to kill anything. A free port must be answered without starting PowerShell at all.

Two further constraints learned the hard way:

* Every OS command's output must distinguish "ran and found nothing" from "could not run". Silently swallowing errors hid a mistyped cmdlet name for a whole release.
* `Get-Process StartTime` is local-time; comparing it against `[DateTime]::UtcNow` yields a negative age, which the display layer then drops.

## 6. Out of Scope (V1)
* Killing Docker containers directly. The host-level binding process is left alone as well; the user is told to stop the container instead (see 4.2 Scenario C).
* Network scanning for remote ports.
* Managing ports bound by root-only processes. The bind probe detects these and reports the port as unclaimable rather than free, but the tool never escalates privileges.

## 7. Future Enhancements (V2)
* **Configurable Safe-Lists:** *(shipped — `.reclaimignore` plus a `port-reclaim` key in `package.json`, which also declares default ports.)*
* **Regex Matching:** *(shipped as `--match REGEX`. It scans every listening socket, matches the command name case-insensitively, and reclaims every port a match holds. The safety model is deliberately unchanged: refusals still block, data services still prompt, and a process holding any protected port is skipped rather than killed. It cannot be combined with port arguments so a mistyped pattern cannot be softened into a port list.)*
* **Terminal styling:** *(shipped — see 5.1.)*

Every item in this document is now implemented. The next revision should record new measurements and defects rather than aspirations, the way 5.3 does.