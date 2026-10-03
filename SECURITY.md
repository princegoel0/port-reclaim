# Security Policy

## Supported Versions

Only the latest published version receives security fixes. Release history is tracked in
[CHANGELOG.md](CHANGELOG.md).

## Reporting a Vulnerability

Please report vulnerabilities **privately**, not in a public issue:

- Use the **Report a vulnerability** form on the
  [Security tab](https://github.com/princegoel0/port-reclaim/security/advisories/new), which
  opens a private advisory thread with the maintainer.
- If that form is unavailable, open a private security advisory against the repository or
  contact the maintainer through their GitHub profile.

Include, as far as you are able:

- the affected version, operating system, and how it was invoked (directly, via `npx`, or from
  a package script)
- the exact command and a reproduction
- the output of `port-reclaim <PORT> --list`, which shows the process name, PID, working
  directory, and uptime the tool decided from

Because this tool terminates processes, **a report that it killed or could kill the wrong
process is treated as a security issue**, not a bug. That includes the working-directory
comparison, the Docker and operating-system PID refusals, the always-prompt data-service list,
and the `.reclaimignore` / `ignore` protection.

Please do not include secrets or personal data, and hold public disclosure until a fix is
released.
