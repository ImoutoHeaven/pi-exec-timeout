import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function shellTimeout(pi: ExtensionAPI) {
  const timeout = Number(process.env.PI_SHELL_TIMEOUT_SECONDS ?? 240);

  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash" && event.toolName !== "powershell") return;
    // Validate here so invalid configuration blocks shell calls instead of unloading the guard.
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2_147_483.647) {
      throw new Error("PI_SHELL_TIMEOUT_SECONDS must be a finite number > 0 and <= 2147483.647 (seconds)");
    }
    // Pi passes a validated copy, so the model's original arguments stay unchanged.
    event.input.timeout = timeout;
  });
}
