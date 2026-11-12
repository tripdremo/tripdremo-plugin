import { access, chmod, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as buildWithEsbuild } from "esbuild";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(pluginRoot, "..");
const mcpSource = path.join(repositoryRoot, "mcp");
const skillsSource = path.join(repositoryRoot, "skills");
const bundledMcp = path.join(pluginRoot, "mcp");
const bundledSkills = path.join(pluginRoot, "skills");
const marketplaceRoot = path.join(pluginRoot, "dist", "marketplace");
const marketplacePlugin = path.join(marketplaceRoot, "plugins", "tripdremo");
const claudeMarketplacePlugin = path.join(marketplaceRoot, "plugins", "tripdremo-claude");
const publicCodexMarketplace = path.join(repositoryRoot, ".agents", "plugins", "marketplace.json");
const publicClaudeMarketplace = path.join(repositoryRoot, ".claude-plugin", "marketplace.json");

const generatedHeader =
  "# DO NOT EDIT: generated from commands/tripdremo.md by scripts/build-plugin.mjs.";

function commandBody(markdown) {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n\n([\s\S]+)$/);
  if (!match) {
    throw new Error("commands/tripdremo.md must contain YAML frontmatter and a command body");
  }
  return match[1];
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

async function validateManifests() {
  const codex = await readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
  const claude = await readJson(path.join(pluginRoot, ".claude-plugin", "plugin.json"));
  const mcp = await readJson(path.join(pluginRoot, ".mcp.json"));

  for (const [label, manifest] of [
    ["Codex manifest", codex],
    ["Claude manifest", claude],
  ]) {
    requireString(manifest.name, `${label} name`);
    requireString(manifest.version, `${label} version`);
    requireString(manifest.description, `${label} description`);
    requireString(manifest.author?.name, `${label} author.name`);
    if (manifest.name !== "tripdremo") {
      throw new Error(`${label} name must be tripdremo`);
    }
  }
  if (codex.version !== claude.version) {
    throw new Error("Codex and Claude manifest versions must match");
  }

  if (codex.interface?.brandColor !== "#111D3A") {
    throw new Error("Codex manifest brandColor must match the #111D3A app icon tile");
  }
  if (codex.interface?.logo !== "./assets/app-icon.svg") {
    throw new Error("Codex manifest logo must use the official ./assets/app-icon.svg");
  }
  if (codex.interface?.composerIcon !== "./assets/app-icon.svg") {
    throw new Error("Codex manifest composerIcon must use the official ./assets/app-icon.svg");
  }
  if (codex.mcpServers !== "./.mcp.json" || codex.skills !== "./skills/") {
    throw new Error("Codex manifest must use the bundled MCP and skill paths");
  }
  for (const asset of [codex.interface?.composerIcon, codex.interface?.logo]) {
    requireString(asset, "Codex manifest asset path");
    if (!asset.startsWith("./assets/") || path.isAbsolute(asset)) {
      throw new Error(`Asset path must be plugin-relative: ${asset}`);
    }
    await access(path.join(pluginRoot, asset));
  }

  const appIcon = await readFile(path.join(pluginRoot, "assets", "app-icon.svg"), "utf8");
  const officialSymbolPaths = [
    "M18 6 H30 C45 6 56 16.7 56 30 C56 43.3 45 54 30 54 H23 L27 45 H30 C39.7 45 47 38.6 47 30 C47 21.4 39.7 15 30 15 H18 Z",
    "M18 6 H27 V23.5 C27 26.7 29.2 27.9 33.7 29.5 C39.2 31.5 41.2 35.4 38.1 40.2 C35.6 44.1 28.5 46.2 26.2 54 H14.8 C16.1 46.9 19.5 42.6 25.9 38.7 C30.1 36.1 31 34.5 26.2 32.7 C20.8 30.7 18 28.2 18 24.1 Z",
  ];
  if (!appIcon.includes('fill="#111D3A"') || !officialSymbolPaths.every((symbolPath) => appIcon.includes(symbolPath))) {
    throw new Error("assets/app-icon.svg must use the #111D3A tile and exact official TripDremo symbol paths");
  }
  try {
    await access(path.join(pluginRoot, "assets", "composerIcon.svg"));
    throw new Error("obsolete assets/composerIcon.svg must not exist");
  } catch (error) {
    if (error instanceof Error && !error.message.includes("ENOENT")) {
      throw error;
    }
  }

  const server = mcp.mcpServers?.tripdremo;
  if (
    mcp.$schema !== "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json" ||
    server?.type !== "stdio" ||
    server?.command !== "node" ||
    !Array.isArray(server.args) ||
    server.args.length !== 1 ||
    server.args[0] !== "${PLUGIN_ROOT}/mcp/bin/tripdremo-mcp.mjs" ||
    server.cwd !== "${PLUGIN_ROOT}"
  ) {
    throw new Error(".mcp.json must declare the portable Codex stdio launcher");
  }
}

async function generateCodexCommand() {
  const markdownPath = path.join(pluginRoot, "commands", "tripdremo.md");
  const tomlPath = path.join(pluginRoot, "commands", "tripdremo.toml");
  const markdown = await readFile(markdownPath, "utf8");
  const matches = markdown.match(/\$ARGUMENTS/g) ?? [];
  if (matches.length !== 1) {
    throw new Error("commands/tripdremo.md must contain exactly one $ARGUMENTS placeholder");
  }
  if (markdown.includes('"""')) {
    throw new Error('commands/tripdremo.md cannot contain a TOML triple-quote delimiter');
  }

  const prompt = commandBody(markdown).replace("$ARGUMENTS", "{{args}}").trimEnd();
  const generated = `${generatedHeader}\n` +
    'description = "Plan trips and manage Tripdremo sessions."\n' +
    `prompt = """\n${prompt}\n"""\n`;
  await writeFile(tomlPath, generated, "utf8");
}

async function bundleMcp() {
  await access(path.join(mcpSource, "dist", "index.js"));
  await access(path.join(mcpSource, "bin", "tripdremo-mcp.mjs"));
  const sourcePackage = await readJson(path.join(mcpSource, "package.json"));

  await rm(bundledMcp, { recursive: true, force: true });
  await mkdir(path.join(bundledMcp, "bin"), { recursive: true });
  await mkdir(path.join(bundledMcp, "dist"), { recursive: true });
  const bundledEntry = path.join(bundledMcp, "dist", "index.js");
  await buildWithEsbuild({
    entryPoints: [path.join(mcpSource, "dist", "index.js")],
    outfile: bundledEntry,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    minifyWhitespace: true,
    logLevel: "silent",
  });
  const bundledSource = await readFile(bundledEntry, "utf8");
  await writeFile(bundledEntry, bundledSource.replace(/[ \t]+$/gm, ""), "utf8");
  await cp(
    path.join(mcpSource, "bin", "tripdremo-mcp.mjs"),
    path.join(bundledMcp, "bin", "tripdremo-mcp.mjs"),
  );
  await chmod(path.join(bundledMcp, "bin", "tripdremo-mcp.mjs"), 0o755);

  const bundledPackage = {
    name: "@tripdremo/mcp-bundled",
    version: sourcePackage.version,
    private: true,
    type: "module",
  };
  await writeFile(
    path.join(bundledMcp, "package.json"),
    `${JSON.stringify(bundledPackage, null, 2)}\n`,
    "utf8",
  );

}

async function copySkills() {
  const skillDirectories = (await readdir(skillsSource, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  if (skillDirectories.length === 0) {
    throw new Error("repository skills/ must contain at least one skill directory");
  }

  for (const skillDirectory of skillDirectories) {
    await access(path.join(skillsSource, skillDirectory, "SKILL.md"));
  }

  await rm(bundledSkills, { recursive: true, force: true });
  await mkdir(bundledSkills, { recursive: true });
  for (const skillDirectory of skillDirectories) {
    await cp(
      path.join(skillsSource, skillDirectory),
      path.join(bundledSkills, skillDirectory),
      { recursive: true },
    );
  }
}

async function assertCodexCloudSkill(skillRoot, label) {
  const skill = await readFile(path.join(skillRoot, "tripdremo-cloud", "SKILL.md"), "utf8");
  if (/^disable-model-invocation\s*:/m.test(skill)) {
    throw new Error(`${label} tripdremo-cloud/SKILL.md cannot contain Claude-only disable-model-invocation`);
  }
  const openaiMetadata = await readFile(
    path.join(skillRoot, "tripdremo-cloud", "agents", "openai.yaml"),
    "utf8",
  );
  if (!/^policy:\s*$[\s\S]*?^  allow_implicit_invocation: false\s*$/m.test(openaiMetadata)) {
    throw new Error(`${label} tripdremo-cloud must set policy.allow_implicit_invocation to false`);
  }
}

async function injectClaudeCloudPolicy(skillFile) {
  const skill = await readFile(skillFile, "utf8");
  if (/^disable-model-invocation\s*:/m.test(skill)) {
    throw new Error("canonical tripdremo-cloud/SKILL.md must not contain disable-model-invocation");
  }
  if (!skill.startsWith("---\n")) {
    throw new Error("tripdremo-cloud/SKILL.md must start with YAML frontmatter");
  }
  const frontmatterEnd = skill.indexOf("\n---\n", 4);
  if (frontmatterEnd === -1) {
    throw new Error("tripdremo-cloud/SKILL.md must close its YAML frontmatter");
  }
  const generated = `${skill.slice(0, frontmatterEnd)}\ndisable-model-invocation: true${skill.slice(frontmatterEnd)}`;
  await writeFile(skillFile, generated, "utf8");
}

async function assertClaudeCloudSkill(skillRoot) {
  const skill = await readFile(path.join(skillRoot, "tripdremo-cloud", "SKILL.md"), "utf8");
  const matches = skill.match(/^disable-model-invocation:\s*true\s*$/gm) ?? [];
  if (matches.length !== 1) {
    throw new Error("Claude tripdremo-cloud/SKILL.md must contain exactly one disable-model-invocation: true");
  }
}

async function writeClaudeMcpManifest(pluginPath) {
  const manifestPath = path.join(pluginPath, ".mcp.json");
  const manifest = await readJson(manifestPath);
  const server = manifest.mcpServers?.tripdremo;
  if (server?.command !== "node" || !Array.isArray(server.args) || server.args.length !== 1) {
    throw new Error("Claude MCP manifest must contain the Tripdremo node launcher");
  }
  delete manifest.$schema;
  delete server.type;
  server.args = ["${CLAUDE_PLUGIN_ROOT}/mcp/bin/tripdremo-mcp.mjs"];
  server.cwd = "${CLAUDE_PLUGIN_ROOT}";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function writeMarketplaces() {
  await rm(marketplaceRoot, { recursive: true, force: true });
  await mkdir(path.join(marketplaceRoot, ".agents", "plugins"), { recursive: true });
  await mkdir(path.join(marketplaceRoot, ".claude-plugin"), { recursive: true });
  await mkdir(path.dirname(marketplacePlugin), { recursive: true });

  for (const entry of [
    ".codex-plugin",
    ".claude-plugin",
    ".mcp.json",
    "assets",
    "commands",
    "mcp",
    "skills",
  ]) {
    await cp(path.join(pluginRoot, entry), path.join(marketplacePlugin, entry), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  await cp(marketplacePlugin, claudeMarketplacePlugin, {
    recursive: true,
    verbatimSymlinks: true,
  });
  await injectClaudeCloudPolicy(
    path.join(claudeMarketplacePlugin, "skills", "tripdremo-cloud", "SKILL.md"),
  );
  await writeClaudeMcpManifest(claudeMarketplacePlugin);

  await assertCodexCloudSkill(path.join(marketplacePlugin, "skills"), "Codex marketplace");
  await assertClaudeCloudSkill(path.join(claudeMarketplacePlugin, "skills"));

  const codexMarketplace = {
    name: "tripdremo-local",
    interface: { displayName: "Tripdremo Local" },
    plugins: [
      {
        name: "tripdremo",
        source: { source: "local", path: "./plugins/tripdremo" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  };
  const claudeMarketplace = {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: "tripdremo-local",
    description: "Local marketplace for the Tripdremo agent plugin.",
    owner: { name: "Tripdremo", url: "https://tripdremo.com" },
    plugins: [
      {
        name: "tripdremo",
        source: "./plugins/tripdremo-claude",
        description: "Plan real trips and return shareable Tripdremo itineraries.",
        category: "productivity",
      },
    ],
  };
  await writeFile(
    path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json"),
    `${JSON.stringify(codexMarketplace, null, 2)}\n`,
  );
  await writeFile(
    path.join(marketplaceRoot, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify(claudeMarketplace, null, 2)}\n`,
  );

  const publicCodex = {
    name: "tripdremo",
    interface: { displayName: "Tripdremo" },
    plugins: [
      {
        name: "tripdremo",
        source: {
          source: "local",
          path: "./plugin/dist/marketplace/plugins/tripdremo",
        },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  };
  const publicClaude = {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: "tripdremo",
    description: "Tripdremo agent plugin marketplace.",
    owner: { name: "Tripdremo", url: "https://tripdremo.com" },
    plugins: [
      {
        name: "tripdremo",
        source: "./plugin/dist/marketplace/plugins/tripdremo-claude",
        description: "Plan real trips and return shareable Tripdremo itineraries.",
        category: "productivity",
      },
    ],
  };
  await mkdir(path.dirname(publicCodexMarketplace), { recursive: true });
  await mkdir(path.dirname(publicClaudeMarketplace), { recursive: true });
  await writeFile(publicCodexMarketplace, `${JSON.stringify(publicCodex, null, 2)}\n`, "utf8");
  await writeFile(publicClaudeMarketplace, `${JSON.stringify(publicClaude, null, 2)}\n`, "utf8");
}

async function assertGeneratedCommand() {
  const markdown = await readFile(path.join(pluginRoot, "commands", "tripdremo.md"), "utf8");
  const toml = await readFile(path.join(pluginRoot, "commands", "tripdremo.toml"), "utf8");
  const expectedPrompt = commandBody(markdown).replace("$ARGUMENTS", "{{args}}").trimEnd();
  if (!toml.startsWith(generatedHeader) || !toml.includes(expectedPrompt)) {
    throw new Error("generated Codex command is out of sync with its Markdown source");
  }
}

async function run() {
  await validateManifests();
  await assertCodexCloudSkill(skillsSource, "Canonical source");
  await generateCodexCommand();
  await bundleMcp();
  await copySkills();
  await assertCodexCloudSkill(bundledSkills, "Bundled Codex plugin");
  await assertGeneratedCommand();
  await writeMarketplaces();
  console.error(`[build-plugin] built ${pluginRoot}`);
}

run().catch((error) => {
  console.error(`[build-plugin] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
