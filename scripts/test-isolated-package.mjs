import assert from "node:assert/strict";
import { access, cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
    {
      packageName: "tripdremo",
      rootToken: null,
      type: "stdio",
      command: "node",
      args: ["./mcp/bin/tripdremo-mcp.mjs"],
      cwd: ".",
    },
    {
      packageName: "tripdremo-claude",
      rootToken: "${CLAUDE_PLUGIN_ROOT}",
      type: undefined,
      command: "node",
      args: ["${CLAUDE_PLUGIN_ROOT}/mcp/bin/tripdremo-mcp.mjs"],
      cwd: "${CLAUDE_PLUGIN_ROOT}",
    },
  ]) {
    const packagedPlugin = path.join(isolatedRoot, host.packageName);
    await cp(
      path.join(repositoryRoot, "plugin", "dist", "marketplace", "plugins", host.packageName),
      packagedPlugin,
      { recursive: true },
    );
    assert.deepEqual((await readdir(path.join(packagedPlugin, "skills"))).sort(), ["tripdremo", "tripdremo-cloud"]);
    const manifest = JSON.parse(await readFile(path.join(packagedPlugin, ".mcp.json"), "utf8"));
    const server = manifest.mcpServers.tripdremo;
    assert.equal(server.command, host.command);
    assert.equal(server.type, host.type);
    assert.equal(server.cwd, host.cwd);
    assert.deepEqual(server.args, host.args);

    const stderrChunks = [];
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args.map((argument) => host.rootToken ? argument.replace(host.rootToken, packagedPlugin) : argument),
      cwd: host.rootToken ? server.cwd.replace(host.rootToken, packagedPlugin) : packagedPlugin,
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
  const rootVersion = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")).version;
  for (const packageName of ["tripdremo-connect", "tripdremo-connect-claude"]) {
    const packagedPlugin = path.join(isolatedRoot, packageName);
    await cp(path.join(repositoryRoot, "plugin", "dist", "marketplace", "plugins", packageName), packagedPlugin, { recursive: true });
    const manifest = JSON.parse(await readFile(path.join(packagedPlugin, ".mcp.json"), "utf8"));
    assert.deepEqual(manifest.mcpServers, { "tripdremo-connect": { type: "http", url: "https://mcp.tripdremo.com/mcp" } });
    assert.deepEqual(await readdir(path.join(packagedPlugin, "skills")), ["tripdremo-connect"]);
    await assert.rejects(access(path.join(packagedPlugin, "mcp")), { code: "ENOENT" });
    await assert.rejects(access(path.join(packagedPlugin, "node_modules")), { code: "ENOENT" });
    for (const kind of [".codex-plugin", ".claude-plugin"]) {
      const plugin = JSON.parse(await readFile(path.join(packagedPlugin, kind, "plugin.json"), "utf8"));
      assert.equal(plugin.name, "tripdremo-connect"); assert.equal(plugin.version, rootVersion);
    }
    const skill = await readFile(path.join(packagedPlugin, "skills", "tripdremo-connect", "SKILL.md"), "utf8");
    for (const [, target] of skill.matchAll(/\]\((references\/[^)]+)\)/g)) await access(path.join(packagedPlugin, "skills", "tripdremo-connect", target));
  }
  const { build } = await import("esbuild");
  const graph = await build({ entryPoints: [path.join(repositoryRoot, "mcp", "dist", "http.js")], bundle: true, platform: "node", format: "esm", write: false, metafile: true });
  const inputs = Object.keys(graph.metafile.inputs);
  assert.equal(inputs.some((file) => /mcp\/dist\/(auth\/|api\/client)/.test(file)), false, "Hosted runtime must not import the local credential/client modules");
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}

process.stdout.write("Isolated local Codex/Claude handshakes, remote profile manifests and hosted credential boundaries passed.\n");
