# Pi Shell Timeout

Sets a uniform execution timeout on Pi's `bash` and `powershell` tools (default `240` seconds), including calls from `codemode` scripts.

## Requirements and Quickstart

Requires `@earendil-works/pi-coding-agent` (tested on Pi `1.1.0`–`1.4.0`). Pi's `powershell` tool runs on Windows.

Install into user settings (or pass `-l` for project settings):

```sh
pi install .
```

Run once with a custom timeout in PowerShell 7:

```powershell
$env:PI_SHELL_TIMEOUT_SECONDS = "120"
pi -e ./index.ts
```

## Constraints

- **Configuration**: `PI_SHELL_TIMEOUT_SECONDS` is read once at load time and must be a finite number `> 0` and `<= 2147483.647` (decimals allowed).
- **Fail-closed**: Invalid values block `bash` and `powershell` calls with a configuration error while leaving other tools unaffected.
- **Execution scope**: Matches `bash` and `powershell` across direct calls, `codemode` (`tools.bash()` / `tools.powershell()`), and `ctx.executeTool()`, overwriting missing, `null`, shorter, or longer `timeout` values.
- **History invariance**: Mutates only Pi's cloned execution input; tool declarations, system prompt, assistant arguments, and saved session history stay unchanged.
- **Boundaries**: Interactive `!` commands, `pi.exec()`, other tools, and `codemode` `timeout_ms` deadlines use their own timeouts. A later `tool_call` handler can override the timeout.

## Testing

```sh
npm run test:docker
```

Requires Docker and network access. The script runs tests and `tsc --noEmit` across Pi `1.1.0`–`1.4.0` in temporary containers with source mounted read-only; host dependencies stay unchanged.
