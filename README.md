# port-reclaim

A zero-configuration, cross-platform CLI for safely reclaiming ports held by stale local development processes.

## Install

Run it once without installing:

```sh
npx port-reclaim 3000
```

Or install it globally:

```sh
npm install --global port-reclaim
port-reclaim 3000
```

Requires Node.js 18 or newer. Supports macOS, Linux, Windows, WSL, PowerShell, and CMD.

## How It Works

```sh
port-reclaim <PORT> [PORT ...]
```

If the port is free, the command exits successfully. If the process working directory matches the current project, the process is terminated automatically. Processes from another directory, system services, and processes whose working directory cannot be read require explicit confirmation. Confirmation prompts show the process name, working directory, and uptime.

The command uses a graceful termination signal first on Unix-like systems and falls back to a forceful signal if the process remains alive. Windows uses `taskkill /F`.

If confirmation is required in a non-interactive environment, the command declines safely and exits with status `1` (rerun with `--yes` to override).

Ports held by Docker processes (for example `docker-proxy` or Docker Desktop) are never killed. The tool explains that the port looks like Docker and suggests stopping the container instead.

Both TCP and UDP listeners are discovered.

### Options

| Flag | Meaning |
| --- | --- |
| `-l`, `--list` | Report what is using each port without killing anything. |
| `-y`, `--yes` | Terminate processes from other directories without prompting. |
| `-h`, `--help` | Show the help message. |
| `-v`, `--version` | Show the installed version. |

## Configuration

Ports can be declared once so scripts can run plain `port-reclaim` with no arguments. Add a `port-reclaim` key to `package.json`:

```json
{
  "port-reclaim": {
    "ports": [3000, 5173],
    "ignore": [5432]
  }
}
```

Ports in `ignore` are skipped with a notice. A `.reclaimignore` file in the project root protects ports the same way — one port per line, `#` starts a comment:

```text
# databases
5432
6379
```

## Script Integration

Use it in a package script:

```json
{
  "scripts": {
    "dev": "port-reclaim 3000 && next dev"
  }
}
```

Or rely on configured ports:

```json
{
  "scripts": {
    "dev": "port-reclaim && next dev"
  },
  "port-reclaim": { "ports": [3000] }
}
```

The same command can be used from Python, Ruby, Go, Make, or shell scripts.

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | The port was free, listed with `--list`, or successfully released. |
| `1` | The port is still in use, the user declined, or an operation failed. |
| `2` | Invalid command-line input. |

## Programmatic Use

The process runner is exported for use in other tools:

```js
import { createProcessRunner } from "port-reclaim";

const runner = createProcessRunner();
const found = await runner.discover(3000);
for (const process of found) {
  console.log(process.name, process.cwd, process.ageMs);
}
if (found.length > 0) {
  await runner.terminate(found[0].pid);
}
```

## Security Notes

`port-reclaim` only acts on processes listening on the port you provide. It does not scan remote hosts, and it refuses to kill Docker processes — stop those containers yourself. Ports protected by `.reclaimignore` or the `ignore` config are always skipped. Review the process name and working directory before confirming a process from another project. UDP matches are heuristic: a UDP socket on a port can belong to a client as well as a server.

## Development

```sh
npm install
npm test
npm run build
```

Pull requests are tested on Ubuntu, macOS, and Windows with Node.js 18, 20, and 22.

## License

MIT. See [LICENSE](LICENSE).
