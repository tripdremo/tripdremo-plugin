import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const payloadPath = process.argv[2];
if (!payloadPath) {
  throw new Error("Usage: npm run smoke:local -- /absolute/path/to/plan-submission.json");
}

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const payload = JSON.parse(await readFile(path.resolve(payloadPath), "utf8"));
const configDir = await mkdtemp(path.join(os.tmpdir(), "tripdremo-plugin-smoke-"));
const stderrChunks = [];
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry) => entry[1] !== undefined),
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(repositoryRoot, "plugin", "mcp", "bin", "tripdremo-mcp.mjs")],
  cwd: repositoryRoot,
  env: {
    ...env,
    TRIPDREMO_API_BASE_URL: "http://127.0.0.1:8000/api/v1",
    TRIPDREMO_SITE_URL: "http://127.0.0.1:3400",
    TRIPDREMO_LOCALE: "en",
    TRIPDREMO_DEV_USER: `plugin-smoke-${process.pid}-${Date.now()}`,
    TRIPDREMO_CONFIG_DIR: configDir,
    TRIPDREMO_LOG_LEVEL: "silent",
  },
  stderr: "pipe",
});
transport.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
const client = new Client({ name: "tripdremo-local-plugin-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const liveSchema = await client.callTool({
    name: "tripdremo_get_plan_schema",
    arguments: {},
  });
  assert.equal(liveSchema.isError, undefined, "live schema call failed");
  assert.equal(liveSchema.structuredContent?.version, payload.schema_version);

  const { trip: _omittedTrip, ...invalidPlan } = payload.plan;
  const revisionProbe = await client.callTool({
    name: "tripdremo_submit_plan",
    arguments: { ...payload, plan: invalidPlan },
  });
  assert.equal(revisionProbe.isError, undefined, "revision probe returned a tool error");
  assert.equal(revisionProbe.structuredContent?.status, "needs_revision");
  assert.ok(revisionProbe.structuredContent.issues.length > 0);

  let submission = payload;
  const revisions = revisionProbe.structuredContent.issues.map((issue) => String(issue.code));
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await client.callTool({ name: "tripdremo_submit_plan", arguments: submission });
    assert.equal(result.isError, undefined, "plan submission returned a tool error");
    if (result.structuredContent?.status === "ready") break;
    assert.equal(result.structuredContent?.status, "needs_revision");
    revisions.push(
      ...result.structuredContent.issues.map((issue) => String(issue.code)),
    );
    submission = { ...submission, plan: result.structuredContent.plan };
  }

  assert.equal(result?.structuredContent?.status, "ready", "plan did not become ready after two revisions");
  const readyPlan = result.structuredContent.plan;
  assert.equal(typeof readyPlan.share_hash, "string");
  assert.equal(typeof readyPlan.share_url, "string");

  const publicRead = await client.callTool({
    name: "tripdremo_get_plan",
    arguments: { share_hash: readyPlan.share_hash, include_payload: false },
  });
  assert.equal(publicRead.isError, undefined, "public share read failed");
  assert.equal(publicRead.structuredContent?.plan?.share_hash, readyPlan.share_hash);

  process.stdout.write(`${JSON.stringify({
    schema_version: liveSchema.structuredContent.version,
    schema_sha256: liveSchema.structuredContent.sha256,
    revisions,
    title: readyPlan.title,
    share_hash: readyPlan.share_hash,
    share_url: readyPlan.share_url,
    public_read: "ok",
  }, null, 2)}\n`);
} finally {
  await client.close();
  await rm(configDir, { recursive: true, force: true });
}

assert.equal(Buffer.concat(stderrChunks).toString("utf8"), "", "packaged MCP wrote to stderr");
