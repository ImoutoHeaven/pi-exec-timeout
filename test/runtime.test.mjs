import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createAgentSession, createBashToolDefinition, createPowerShellToolDefinition, createCodemodeExtension,
  DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import shellTimeout from "../index.ts";

async function makeSession(cwd, { enabled = true, timeout, operations } = {}) {
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false }, retry: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd, agentDir: join(cwd, "agent"), settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [createCodemodeExtension({ models: false }), ...(enabled ? [shellTimeout] : [])],
  });
  const previous = process.env.PI_SHELL_TIMEOUT_SECONDS;
  if (timeout === undefined) delete process.env.PI_SHELL_TIMEOUT_SECONDS;
  else process.env.PI_SHELL_TIMEOUT_SECONDS = timeout;
  try {
    await loader.reload();
  } finally {
    if (previous === undefined) delete process.env.PI_SHELL_TIMEOUT_SECONDS;
    else process.env.PI_SHELL_TIMEOUT_SECONDS = previous;
  }
  assert.deepEqual(loader.getExtensions().errors, []);
  const modelRuntime = await ModelRuntime.create({
    refreshOnCreate: false, modelsPath: null,
    credentials: {
      read: async () => undefined, list: async () => [],
      modify: async () => { throw new Error("credential write forbidden"); },
      delete: async () => { throw new Error("credential write forbidden"); },
    },
  });
  const sessionManager = SessionManager.create(cwd, join(cwd, "sessions"));
  sessionManager.appendMessage({ role: "user", content: "existing history", timestamp: 1 });
  const { session } = await createAgentSession({
    cwd, agentDir: join(cwd, "agent"), modelRuntime,
    model: modelRuntime.getModels()[0], thinkingLevel: "off",
    resourceLoader: loader, settingsManager, sessionManager,
    tools: ["bash", "powershell", "codemode"],
    ...(operations ? { customTools: [
      createBashToolDefinition(cwd, { operations }), createPowerShellToolDefinition(cwd, { operations }),
    ] } : {}),
  });
  return session;
}

async function runCalls(session, calls) {
  const requests = [];
  let count = 0;
  session.agent.streamFunction = async (model, context) => {
    requests.push(structuredClone(context));
    assert.ok(count < 2, "unexpected model continuation");
    const toolTurn = count++ === 0;
    const message = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: toolTurn ? calls : [{ type: "text", text: "done" }],
      stopReason: toolTurn ? "toolUse" : "stop", timestamp: count,
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    return { [Symbol.asyncIterator]: async function* () {}, result: async () => message };
  };
  // Use the real agent/session hooks without authentication or network preflight.
  await session.agent.prompt("run fixture");
  assert.equal(count, 2);
  assert.deepEqual(requests[1].messages.slice(0, requests[0].messages.length), requests[0].messages);
  return session.messages.filter((message) => message.role === "toolResult");
}

for (const [configured, expected] of [[undefined, 240], ["0.25", 0.25]]) {
  test(`direct and real codemode execution use ${expected}s without changing history or declarations`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-bash-timeout-"));
    const received = [];
    const operations = {
      exec: async (command, _cwd, options) => {
        received.push({ command, timeout: options.timeout });
        options.onData(Buffer.from("ok\n"));
        return { exitCode: 0 };
      },
    };
    let baseline, session;
    try {
      baseline = await makeSession(cwd, { enabled: false, operations });
      session = await makeSession(cwd, { timeout: configured, operations });
      const declarations = JSON.stringify(baseline.agent.state.tools);
      const prompt = baseline.systemPrompt;
      assert.equal(JSON.stringify(session.agent.state.tools), declarations);
      assert.equal(session.systemPrompt, prompt);
      const oldEntries = JSON.stringify(session.sessionManager.getEntries());
      const file = session.sessionManager.getSessionFile();
      const oldBytes = await readFile(file);
      const inputs = [];
      const calls = [];
      for (const toolName of ["bash", "powershell"]) {
        const shellInputs = [{ command: `${toolName}-missing` }, { command: `${toolName}-null`, timeout: null },
          { command: `${toolName}-short`, timeout: 1 }, { command: `${toolName}-long`, timeout: 900 }];
        inputs.push(...shellInputs);
        calls.push(...shellInputs.map((input, index) => ({
          type: "toolCall", id: `${toolName}-direct-${index}`, name: toolName, arguments: structuredClone(input),
        })), {
          type: "toolCall", id: `${toolName}-nested`, name: "codemode",
          arguments: { code: `const inputs = ${JSON.stringify(shellInputs)};
const before = JSON.stringify(inputs);
const results = await Promise.all(inputs.map(input => tools.${toolName}(input)));
if (JSON.stringify(inputs) !== before) throw new Error("script arguments changed");
text(results);` },
        });
      }
      const original = structuredClone(calls);
      const results = await runCalls(session, calls);
      assert.equal(results.length, 10);
      assert.ok(results.every((result) => !result.isError), JSON.stringify(results));
      assert.deepEqual(received.sort((a, b) => a.command.localeCompare(b.command)),
        [...inputs, ...inputs].map(({ command }) => ({ command, timeout: expected }))
          .sort((a, b) => a.command.localeCompare(b.command)));
      assert.deepEqual(calls, original);
      assert.deepEqual(session.messages.find((message) => message.role === "assistant").content, original);
      assert.equal(JSON.stringify(session.agent.state.tools), declarations);
      assert.equal(session.systemPrompt, prompt);
      assert.deepEqual(JSON.parse(JSON.stringify(session.sessionManager.getEntries())).slice(0, JSON.parse(oldEntries).length),
        JSON.parse(oldEntries));
      assert.ok((await readFile(file)).subarray(0, oldBytes.length).equals(oldBytes), "saved prefix changed");
    } finally {
      baseline?.dispose();
      session?.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test("invalid configuration fails closed through direct and codemode execution", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-bash-timeout-invalid-"));
  let session;
  try {
    session = await makeSession(cwd, { timeout: "bad", operations: {
      exec: async () => assert.fail("invalid configuration allowed shell execution"),
    } });
    const results = await runCalls(session, [
      ...["bash", "powershell"].map((name) => ({
        type: "toolCall", id: name, name, arguments: { command: "echo ok" },
      })),
      { type: "toolCall", id: "nested", name: "codemode",
        arguments: { code: "await Promise.all([tools.bash({command:'echo ok'}), tools.powershell({command:'echo ok'})]);" } },
    ]);
    assert.equal(results.length, 3);
    for (const result of results) {
      assert.equal(result.isError, true, JSON.stringify(result));
      assert.match(JSON.stringify(result.content), /PI_SHELL_TIMEOUT_SECONDS/);
    }
  } finally {
    session?.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});

for (const toolName of ["bash", "powershell"]) {
  test(`real direct and codemode ${toolName} loops return timeout errors`, {
    timeout: 20_000,
    skip: toolName === "powershell" && process.platform !== "win32" ? "Pi powershell is Windows-only" : false,
  }, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-bash-timeout-loop-"));
    let session;
    try {
      const seconds = toolName === "bash" ? "0.2" : "2";
      session = await makeSession(cwd, { timeout: seconds });
      const command = toolName === "bash" ? "echo loop-started; while :; do sleep 1; done"
        : "Write-Output 'loop-started'; while ($true) { Start-Sleep -Milliseconds 100 }";
      const started = performance.now();
      const results = await runCalls(session, [
        { type: "toolCall", id: "loop-direct", name: toolName, arguments: { command, timeout: 900 } },
        { type: "toolCall", id: "loop-nested", name: "codemode",
          arguments: { code: `await tools.${toolName}({command: ${JSON.stringify(command)}});` } },
      ]);
      assert.equal(results.length, 2);
      for (const result of results) {
        assert.equal(result.isError, true, JSON.stringify(result));
        const output = JSON.stringify(result.content);
        assert.ok(output.includes(`Command timed out after ${seconds} seconds`), output);
        assert.match(output, /loop-started/);
      }
      assert.ok(performance.now() - started < 10_000, "loop did not stop promptly");
    } finally {
      session?.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
