import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "tripdremo-package-test-"));
const packagedPlugin = path.join(isolatedRoot, "plugin");
await cp(
  path.join(repositoryRoot, "plugin", "dist", "marketplace", "plugins", "tripdremo"),
  packagedPlugin,
  { recursive: true },
);

const env = Object.fromEntries(
  Object.entries(process.env).filter((entry) => entry[1] !== undefined),
);
const stderrChunks = [];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(packagedPlugin, "mcp", "bin", "tripdremo-mcp.mjs")],
  cwd: packagedPlugin,
  env: { ...env, TRIPDREMO_LOG_LEVEL: "silent" },
  stderr: "pipe",
});
transport.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
const client = new Client({ name: "tripdremo-isolated-package-test", version: "0.1.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  assert.ok(names.includes("tripdremo_get_plan_schema"));
  assert.ok(names.includes("tripdremo_submit_plan"));
} finally {
  await client.close();
  await rm(isolatedRoot, { recursive: true, force: true });
}

assert.equal(Buffer.concat(stderrChunks).toString("utf8"), "");
process.stdout.write("Isolated packaged MCP handshake passed.\n");
