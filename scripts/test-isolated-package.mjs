import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "tripdremo-package-test-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry) => entry[1] !== undefined),
);

try {
  for (const host of [
    { packageName: "tripdremo", rootToken: "${PLUGIN_ROOT}" },
    { packageName: "tripdremo-claude", rootToken: "${CLAUDE_PLUGIN_ROOT}" },
  ]) {
    const packagedPlugin = path.join(isolatedRoot, host.packageName);
    await cp(
      path.join(repositoryRoot, "plugin", "dist", "marketplace", "plugins", host.packageName),
      packagedPlugin,
      { recursive: true },
    );
    const manifest = JSON.parse(await readFile(path.join(packagedPlugin, ".mcp.json"), "utf8"));
    const server = manifest.mcpServers.tripdremo;
    assert.equal(server.command, "node");
    assert.equal(server.cwd, undefined);
    assert.deepEqual(server.args, [`${host.rootToken}/mcp/bin/tripdremo-mcp.mjs`]);

    const stderrChunks = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: server.args.map((argument) => argument.replace(host.rootToken, packagedPlugin)),
      cwd: isolatedRoot,
      env: { ...env, TRIPDREMO_LOG_LEVEL: "silent" },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    const client = new Client({ name: `tripdremo-${host.packageName}-test`, version: "0.1.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      assert.ok(names.includes("tripdremo_get_plan_schema"));
      assert.ok(names.includes("tripdremo_submit_plan"));
    } finally {
      await client.close();
    }
    assert.equal(Buffer.concat(stderrChunks).toString("utf8"), "");
  }
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}

process.stdout.write("Isolated Codex and Claude packaged MCP handshakes passed.\n");
