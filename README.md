# Pi Shell Timeout

Sets a uniform execution timeout on Pi's `bash` and `powershell` tools across Pi 1.1.0, 1.2.0, 1.3.0, and 1.4.0. The default timeout is **240 seconds (4 minutes)**. Pi's built-in `powershell` executor runs on Windows.

## Loading and Configuration

Load the extension for a single run from this directory:

```sh
pi -e ./index.ts
```

Set `PI_SHELL_TIMEOUT_SECONDS` (in seconds) before starting Pi. PowerShell 7 example:

```powershell
$env:PI_SHELL_TIMEOUT_SECONDS = "120"
pi -e ./index.ts
```

Run `pi install .` in this directory to add the package to user Pi settings, or `pi install -l .` for project settings.

`PI_SHELL_TIMEOUT_SECONDS` is read once when the extension loads:

- When unset, the timeout defaults to `240`.
- When set, the value must be a finite number `> 0` and `<= 2147483.647` (decimals allowed).
- An empty or out-of-range value fails closed: `bash` and `powershell` calls throw a configuration error before execution, while all other tools keep their normal behavior.

## Execution Scope and History Invariance

The extension registers a single `tool_call` handler that matches the exact tool names `bash` and `powershell` and assigns `event.input.timeout`, adding a missing `timeout` or overwriting any model-supplied value (including `null`, shorter, or longer values).

Direct tool calls, `codemode` script calls (`tools.bash(...)` and `tools.powershell(...)`), and `ctx.executeTool()` calls all pass through Pi's tool execution pipeline and receive the configured timeout.

Pi clones and validates tool arguments before invoking `tool_call` handlers. The extension mutates only that execution copy, leaving tool declarations, active tool selection, the system prompt, original assistant tool-call arguments, transcript messages, and saved session history prefixes unchanged.

Only `bash` and `powershell` tool calls are affected. Interactive `!` shell commands, `pi.exec()`, other tools (such as FastExec or IDA), and overall `codemode` script deadlines (`timeout_ms`) use their own timeouts.

Process termination, cancellation, output capture, and timeout error results are handled by Pi's built-in executors. The timeout bounds process execution rather than non-process host filesystem operations. Because `tool_call` handlers run in extension registration order, a later extension that mutates `event.input.timeout` determines the final value.

## Verification

```sh
npm run test:docker
```

`test/docker.sh` mounts the repository read-only into ephemeral `node:24.21.0-bookworm-slim` containers, installs `@earendil-works/pi-coding-agent` for Pi `1.1.0`, `1.2.0`, `1.3.0`, and `1.4.0` with matching `@earendil-works/*` package overrides, and runs `npm test` plus strict `tsc --noEmit`. Host dependencies remain unchanged. Requires a running Docker daemon and network access.

The test suite verifies the default `240s` timeout, custom `PI_SHELL_TIMEOUT_SECONDS` values, fail-closed invalid configuration, direct and `codemode` execution for both tools, executor-received timeouts, argument preservation on unrelated tools, invariance of tool declarations, system prompt, original call arguments, and saved session prefixes, and real infinite-loop termination (`bash` runs on all platforms; `powershell` loop execution runs on Windows and skips in Linux containers).
