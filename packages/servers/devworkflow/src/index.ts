import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { env, Bump } from "../../../sdk-utils/dist/index.js";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { exec as _exec } from "node:child_process";
const exec = promisify(_exec);

type Tool = {
  name: string;
  description: string;
  inputSchema?: any;
  run: (args: any) => Promise<any>;
};

function createServer(info: { name: string; version: string }) {
  const server = new Server(info, { capabilities: { tools: {} as Record<string, unknown> } });
  const tools = new Map<string, Tool>();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(tools.values()).map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
    const tool = tools.get(req.params.name);
    if (!tool) throw new Error(`Tool not found: ${req.params.name}`);
    const result = await tool.run(req.params.arguments || {});
    return { result };
  });

  return {
    tools,
    addTool: (tool: Tool) => {
      tools.set(tool.name, tool);
    },
    start: async () => {
      await server.connect(new StdioServerTransport());
    }
  };
}

async function run(cmd: string, args: string[], cwd: string, extraEnv: Record<string,string> = {}) {
  return new Promise<{ code:number; stdout:string; stderr:string }>((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

function semrelBin(): string {
  try {
    return require.resolve("semantic-release/bin/semantic-release.js");
  } catch {
    try {
      return require.resolve("semantic-release/bin/semantic-release.cjs");
    } catch {
      return "npx";
    }
  }
}

function parseSemrel(out: string) {
  const versionMatch = out.match(/next release version is\s+(\d+\.\d+\.\d+(?:-[\w.-]+)?)/i);
  const typeMatch = out.match(/Release type:\s*(major|minor|patch)/i);
  const notesStart = out.indexOf("\n\n### ");
  const notes = notesStart >= 0 ? out.slice(notesStart + 2).trim() : "";
  return {
    nextVersion: versionMatch?.[1] ?? null,
    releaseType: (typeMatch?.[1] ?? (versionMatch ? "patch" : "none")) as z.infer<typeof Bump>,
    notes
  };
}

function inferBumpFromCommits(commits: string[]): z.infer<typeof Bump> {
  let major = false, minor = false, patch = false;
  for (const m of commits) {
    if (/BREAKING CHANGE|!:/i.test(m)) major = true;
    else if (/^feat(\(|:)/i.test(m)) minor = true;
    else if (/^(fix|perf|refactor|revert|chore|build|ci|docs|style|test)(\(|:)/i.test(m)) patch = true;
  }
  if (major) return "major";
  if (minor) return "minor";
  if (patch) return "patch";
  return "none";
}

const server = createServer({ name: "Growthstats DevWorkflow", version: "0.1.0" });

server.addTool({
  name: "health.ping",
  description: "Check if the DevWorkflow server is alive.",
  run: async () => ({ ok: true, ts: new Date().toISOString() })
});

const DryRunInput = z.object({
  repoPath: z.string().optional(),
  branch: z.string().optional()
});

server.addTool({
  name: "release.dryRun",
  description: "Run semantic-release in dry mode and return next version + notes.",
  inputSchema: DryRunInput,
  run: async ({ repoPath, branch }: z.infer<typeof DryRunInput>) => {
    const cwd = repoPath || env("REPO_PATH");
    const bin = semrelBin();
    const args = bin === "npx"
      ? ["semantic-release", "--dry-run", "--no-ci", ...(branch ? ["--branches", branch] : [])]
      : ["--dry-run", "--no-ci", ...(branch ? ["--branches", branch] : [])];
    const { stdout, stderr, code } = await run(bin, args, cwd, {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
      GH_TOKEN: process.env.GITHUB_TOKEN || ""
    });
    const combined = stdout + "\n" + stderr;
    const parsed = parseSemrel(combined);
    return { ok: code === 0, code, ...parsed, raw: combined };
  }
});

const GuardInput = z.object({
  prTitle: z.string(),
  commits: z.array(z.string()).optional()
});

server.addTool({
  name: "git.versionGuard",
  description: "Validate PR title bump tag against conventional commit signals.",
  inputSchema: GuardInput,
  run: async ({ prTitle, commits }: z.infer<typeof GuardInput>) => {
    const titleMatch = prTitle.match(/\[Release\]\s*\[(MAJOR|MINOR|PATCH)\]/i);
    const declared = (titleMatch?.[1] || "").toLowerCase();
    const inferred = commits && commits.length ? inferBumpFromCommits(commits) : "none";
    const rank = (b: string) => ({ none:0, patch:1, minor:2, major:3 } as Record<string, number>)[b] ?? 0;
    const violations: string[] = [];
    if (!declared) violations.push("PR title missing [Release][MAJOR|MINOR|PATCH] tag.");
    if (inferred !== "none" && declared && rank(declared) < rank(inferred)) {
      violations.push(`Declared ${declared.toUpperCase()} but commits imply ${inferred.toUpperCase()}.`);
    }
    return {
      declared: declared || null,
      inferred: inferred === "none" ? null : inferred,
      ok: violations.length === 0,
      violations
    };
  }
});

const ChangelogInput = z.object({
  repoPath: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional()
});

server.addTool({
  name: "git.changelog",
  description: "Generate a simple conventional-style changelog between two points.",
  inputSchema: ChangelogInput,
  run: async ({ repoPath, since, until }: z.infer<typeof ChangelogInput>) => {
    const cwd = repoPath || env("REPO_PATH");
    const range = since ? `${since}..${until || "HEAD"}` : (until || "HEAD");
    const { stdout } = await exec(`git log --pretty=format:%s__%b__%H ${range}`, { cwd });
    type Bucket = { title: string; items: string[] };
    const buckets: Record<string, Bucket> = {
      breaking: { title: "\uD83D\uDCA5 Breaking Changes", items: [] },
      feat:     { title: "\u2728 Features", items: [] },
      fix:      { title: "\uD83D\uDC1B Fixes", items: [] },
      perf:     { title: "\u26A1 Performance", items: [] },
      other:    { title: "\uD83E\uDDF0 Other", items: [] }
    };
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const [subject, body] = line.split("__");
      const item = `- ${subject}`;
      if (/BREAKING CHANGE|!:/i.test(body) || /!:/i.test(subject)) buckets.breaking.items.push(item);
      else if (/^feat(\(|:)/i.test(subject)) buckets.feat.items.push(item);
      else if (/^fix(\(|:)/i.test(subject)) buckets.fix.items.push(item);
      else if (/^perf(\(|:)/i.test(subject)) buckets.perf.items.push(item);
      else buckets.other.items.push(item);
    }
    const sections = Object.values(buckets)
      .filter(b => b.items.length)
      .map(b => `### ${b.title}\n${b.items.join("\n")}`)
      .join("\n\n");
    return { range, sections };
  }
});

server.start();
