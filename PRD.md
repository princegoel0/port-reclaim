# PRD: Smart Port Reclaimer (`port-reclaim`)

## 1. Overview
### 1.1 The Problem
When developing locally (Node.js, Python, Ruby, etc.), servers frequently crash or are stopped improperly, leaving the underlying process holding onto the port (e.g., `EADDRINUSE :::3000`). To fix this, developers must manually identify the process ID (PID) using tools like `lsof` or `netstat` and explicitly kill it. This interrupts workflow multiple times a day.

### 1.2 The Solution
`port-reclaim` is a zero-configuration, cross-platform CLI tool that intelligently identifies and resolves port conflicts. Unlike brute-force "kill-port" tools, it determines *what* is running on the port. If the process belongs to the current project, it silently restarts it. If it belongs to a different project or system service, it prompts the user for confirmation before acting.

## 2. Target Audience
* Backend Developers (Node.js, Python FastAPI/Django, Go)
* Frontend Developers (React/Next.js, Vue/Nuxt, Vite)
* Full-Stack Engineers running multiple local services

## 3. Product Goals & Metrics
* **Goal 1:** Eliminate the manual `lsof -i :PORT` -> `kill -9 PID` loop entirely.
* **Goal 2:** Provide a safe mechanism that prevents developers from accidentally killing essential system services or databases.
* **Goal 3:** Seamless integration into existing NPM/Pip scripts.
* **Success Metric:** Time to resolve an `EADDRINUSE` error drops from ~45 seconds to < 2 seconds.

## 4. Core Features

### 4.1 Intelligent Process Identification (The "Smart" part)
* The tool must identify the PID holding the specified port.
* It must extract the **command name** (e.g., `node`, `python`, `docker`).
* It must determine the **Current Working Directory (CWD)** of the blocking process.

### 4.2 Context-Aware Resolution Strategy
* **Scenario A: Same Project Match:** If the blocking process's CWD matches the directory where `port-reclaim` is invoked, the tool assumes it is a stale process from the current project and **automatically kills it** (SIGTERM, falling back to SIGKILL).
* **Scenario B: Different Project / System Service:** If the CWD does *not* match, or if it is a known system process (e.g., `postgres`), the tool pauses and displays an interactive prompt.
  * *Prompt Example:* `Port 3000 is used by 'node' in '/users/dev/other-project'. Kill it? (y/N)`

### 4.3 Cross-Platform Support
* Must work consistently across macOS, Linux, and Windows (WSL and native CMD/PowerShell).

### 4.4 CLI Integration
* Designed to be chained in package managers.
  * *NPM Example:* `"dev": "port-reclaim 3000 && next dev"`

## 5. Technical Requirements

### 5.1 Proposed Stack
* **Language:** Node.js (TypeScript) or Python. 
* **Key Libraries (Node.js Example):**
  * `find-process` or custom `lsof`/`netstat` parsing logic to get PIDs.
  * `prompts` or `inquirer` for the interactive CLI confirmation.
  * `chalk` or `kleur` for terminal styling.

### 5.2 Flow Logic
1. **Input:** `port-reclaim <PORT>`
2. **Scan:** Execute OS-level command (`lsof` on Unix, `netstat` on Windows) to find the PID using `<PORT>`.
3. **If no PID found:** Exit 0 (Success, port is free).
4. **If PID found:** Get process metadata (Name, CWD).
5. **Evaluate:**
   * `If ProcessCWD == CurrentExecutionCWD:` Send `SIGKILL` to PID -> Exit 0.
   * `Else:` Display Prompt.
     * `If User == Yes:` Send `SIGKILL` to PID -> Exit 0.
     * `If User == No:` Exit 1 (Failure, port remains blocked).

## 6. Out of Scope (V1)
* Killing Docker containers directly (will only kill the host-level binding process for now).
* Network scanning for remote ports.
* Managing ports bound by root-only processes.

## 7. Future Enhancements (V2)
* **Configurable Safe-Lists:** A `.reclaimignore` file to never touch specific ports (e.g., `5432` for Postgres).
* **Regex Matching:** Allow killing by process name regex instead of exact port.