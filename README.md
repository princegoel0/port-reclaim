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
port-reclaim <PORT>
```

If the port is free, the command exits successfully. If the process working directory matches the current project, the process is terminated automatically. Processes from another directory, system services, and processes whose working directory cannot be read require explicit confirmation.

The command uses a graceful termination signal first on Unix-like systems and falls back to a forceful signal if the process remains alive. Windows uses `taskkill`.

If confirmation is required in a non-interactive environment, the command declines safely and exits with status `1`.

## Script Integration

Use it in a package script:

```json
{
  "scripts": {
    "dev": "port-reclaim 3000 && next dev"
  }
}
```

The same command can be used from Python, Ruby, Go, Make, or shell scripts.

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | The port was free or was successfully released. |
| `1` | The port is still in use, the user declined, or an operation failed. |
| `2` | Invalid command-line input. |

## Security Notes

`port-reclaim` only acts on processes listening on the port you provide. It does not scan remote hosts or kill Docker containers directly. Review the process name and working directory before confirming a process from another project.

## Development

```sh
npm install
npm test
npm run build
```

Pull requests are tested on Ubuntu, macOS, and Windows with Node.js 18, 20, and 22.

## License

MIT. See [LICENSE](LICENSE).
