import assert from "node:assert/strict";
import { test } from "node:test";
import shellTimeout from "../index.ts";

function load(value) {
  const previous = process.env.PI_SHELL_TIMEOUT_SECONDS;
  if (value === undefined) delete process.env.PI_SHELL_TIMEOUT_SECONDS;
  else process.env.PI_SHELL_TIMEOUT_SECONDS = value;
  let handle;
  try {
    shellTimeout({ on: (event, handler) => {
      assert.equal(event, "tool_call");
      handle = handler;
    } });
  } finally {
    if (previous === undefined) delete process.env.PI_SHELL_TIMEOUT_SECONDS;
    else process.env.PI_SHELL_TIMEOUT_SECONDS = previous;
  }
  assert.equal(typeof handle, "function");
  return handle;
}

test("both shell tools add or overwrite the timeout, using the value captured at load", () => {
  for (const [configured, expected] of [[undefined, 240], ["0.25", 0.25], ["2147483.647", 2147483.647]]) {
    const handle = load(configured);
    for (const toolName of ["bash", "powershell"]) {
      for (const input of [{ command: "echo ok" }, { command: "echo ok", timeout: null },
        { command: "echo ok", timeout: 1 }, { command: "echo ok", timeout: 900 }]) {
        handle({ toolName, input });
        assert.deepEqual(input, { command: "echo ok", timeout: expected });
      }
    }
  }
});

test("unrelated tools keep every argument unchanged", () => {
  for (const configured of [undefined, "bad"]) {
    const handle = load(configured);
    for (const toolName of ["read", "mcp__fastexec__fastexec", "codemode", "ida_execute_python", "my_bash"]) {
      const input = { command: "echo ok", timeout: 17, extra: "keep" };
      handle({ toolName, input });
      assert.deepEqual(input, { command: "echo ok", timeout: 17, extra: "keep" });
    }
  }
});

test("invalid configuration blocks shell calls rather than unloading the protection", () => {
  for (const value of ["", " ", "bad", "0", "-1", "NaN", "Infinity", "2147483.648"]) {
    const handle = load(value);
    for (const toolName of ["bash", "powershell"]) {
      const input = { command: "echo ok" };
      assert.throws(() => handle({ toolName, input }), /PI_SHELL_TIMEOUT_SECONDS/);
      assert.deepEqual(input, { command: "echo ok" });
    }
  }
});
