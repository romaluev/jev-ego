#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { startFixtureServer } from "../scripts/serve-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist", "jev-ego.mjs");
const ONESHOT = new Set(["flights", "smoke", "probe"]);
const DAEMON = new Set(["observe", "act", "suggest", "step", "goto", "spaces", "stop"]);

function loadEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) {
    return;
  }
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function printHelp() {
  console.log(`jev-ego — Jev Ultrafast on ego lite

One-shot:
  jev-ego run --url URL --goal TEXT [--keep-open] [--trace DIR] [--profile ID]
  jev-ego flights [--keep-open] [--output DIR] [--profile ID]
  jev-ego smoke [--keep-open] [--output DIR] [--profile ID]
  jev-ego probe [--url URL] [--output DIR] [--profile ID]

Agent stepper:
  jev-ego serve --url URL [--goal TEXT] [--profile ID]
  jev-ego observe [--full] [--space N] [--json]
  jev-ego act OP [TARGET] [TEXT] [--space N] [--json]
  jev-ego suggest [--goal TEXT] [--top K] [--space N] [--json]
  jev-ego step [--goal TEXT] [--space N] [--json]
  jev-ego run --goal TEXT --max-steps K [--space N] [--json]
  jev-ego goto URL [--space N] [--json]
  jev-ego spaces
  jev-ego stop [--keep-open] [--space N]

Requires ego-browser on PATH and a built bundle (pnpm build).
`);
}

function registryDir(override) {
  return override ?? join(homedir(), ".jev-ego", "spaces");
}

function listSpaces(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")))
    .sort((left, right) => left.spaceId - right.spaceId);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") {
    printHelp();
    process.exit(command ? 0 : 1);
  }
  const known = new Set(["run", "flights", "smoke", "probe", "serve", ...DAEMON]);
  if (!known.has(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
  const args = { command, goals: [], positionals: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    const next = rest[i + 1];
    switch (token) {
      case "--url":
        args.url = next;
        i += 1;
        break;
      case "--goal":
        args.goals.push(next);
        i += 1;
        break;
      case "--keep-open":
        args.keepOpen = true;
        break;
      case "--trace":
        args.traceDir = resolve(next);
        i += 1;
        break;
      case "--output":
        args.outputDir = resolve(next);
        i += 1;
        break;
      case "--profile":
        args.profileId = next;
        i += 1;
        break;
      case "--space":
        args.space = Number(next);
        i += 1;
        break;
      case "--top":
        args.top = Number(next);
        i += 1;
        break;
      case "--max-steps":
        args.maxSteps = Number(next);
        i += 1;
        break;
      case "--registry-dir":
        args.registryDir = resolve(next);
        i += 1;
        break;
      case "--full":
        args.full = true;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        if (token.startsWith("-")) {
          console.error(`Unknown option: ${token}`);
          process.exit(1);
        }
        args.positionals.push(token);
        break;
    }
  }
  if (command === "run" && args.url && args.goals.length === 0) {
    console.error("run requires --goal");
    process.exit(1);
  }
  if (command === "serve" && !args.url) {
    console.error("serve requires --url");
    process.exit(1);
  }
  return args;
}

function runEgo(args) {
  if (!existsSync(dist)) {
    console.error("Missing dist/jev-ego.mjs. Run `pnpm build` first.");
    process.exit(1);
  }
  args.envPath = args.envPath ?? join(process.cwd(), ".env");
  return new Promise((resolvePromise) => {
    const child = spawn("ego-browser", ["nodejs"], {
      stdio: ["pipe", "inherit", "inherit"],
      env: process.env,
    });
    child.stdin.write(`globalThis.__jevArgs=${JSON.stringify(args)};\n`);
    child.stdin.write(readFileSync(dist));
    child.stdin.end();
    child.on("exit", (code, signal) => {
      resolvePromise(signal ? 1 : (code ?? 1));
    });
  });
}

async function spawnDaemon(args) {
  if (!existsSync(dist)) {
    console.error("Missing dist/jev-ego.mjs. Run `pnpm build` first.");
    process.exit(1);
  }
  const dir = registryDir(args.registryDir);
  const serveToken = randomBytes(16).toString("hex");
    const payload = {
    command: "serve",
    url: args.url,
    goals: args.goals,
    profileId: args.profileId,
    registryDir: dir,
    serveToken,
    envPath: join(process.cwd(), ".env"),
  };
  const child = spawn("ego-browser", ["nodejs"], {
    stdio: ["pipe", "ignore", "ignore"],
    detached: true,
    env: process.env,
  });
  child.stdin.write(`globalThis.__jevArgs=${JSON.stringify(payload)};\n`);
  child.stdin.write(readFileSync(dist));
  child.stdin.end();
  child.unref();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const match = listSpaces(dir).find((entry) => entry.serveToken === serveToken);
    if (match) {
      return match;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error("Daemon did not register a space within 30s");
}

function resolveSpace(args) {
  const dir = registryDir(args.registryDir);
  const spaces = listSpaces(dir);
  if (args.space) {
    const found = spaces.find((entry) => entry.spaceId === args.space);
    if (!found) {
      throw new Error(`No running space ${args.space}`);
    }
    return found;
  }
  if (spaces.length === 1) {
    return spaces[0];
  }
  if (spaces.length === 0) {
    throw new Error("No jev-ego daemon. Start one with: jev-ego serve --url URL");
  }
  throw new Error(`Multiple spaces: ${spaces.map((entry) => entry.spaceId).join(", ")}. Pass --space N`);
}

async function clientRequest(space, path, body) {
  const response = await fetch(`http://127.0.0.1:${space.port}${path}`, {
    method: path === "/state" ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Jev-Token": space.token,
      Host: `127.0.0.1:${space.port}`,
    },
    body: path === "/state" ? undefined : JSON.stringify(body ?? {}),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload;
}

function printResult(args, payload) {
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (typeof payload.text === "string") {
    console.log(payload.text);
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
}

async function daemonCommand(args) {
  if (args.command === "spaces") {
    const spaces = listSpaces(registryDir(args.registryDir));
    if (args.json) {
      console.log(JSON.stringify(spaces, null, 2));
      return;
    }
    if (spaces.length === 0) {
      console.log("No running spaces.");
      return;
    }
    for (const space of spaces) {
      console.log(`${space.spaceId}  :${space.port}  ${space.url}  ${space.goal}`);
    }
    return;
  }
  const space = resolveSpace(args);
  switch (args.command) {
    case "observe":
      printResult(args, await clientRequest(space, "/observe", { full: Boolean(args.full) }));
      return;
    case "act": {
      const [operation, target, text] = args.positionals;
      if (!operation) {
        throw new Error("act requires OP [TARGET] [TEXT]");
      }
      printResult(
        args,
        await clientRequest(space, "/act", { operation, target, text }),
      );
      return;
    }
    case "suggest":
      printResult(
        args,
        await clientRequest(space, "/suggest", {
          goal: args.goals[0],
          top: args.top ?? 8,
        }),
      );
      return;
    case "step":
      printResult(args, await clientRequest(space, "/step", { goal: args.goals[0] }));
      return;
    case "run":
      printResult(
        args,
        await clientRequest(space, "/run", {
          goal: args.goals[0],
          maxSteps: args.maxSteps ?? 20,
        }),
      );
      return;
    case "goto": {
      const url = args.url ?? args.positionals[0];
      if (!url) {
        throw new Error("goto requires a URL");
      }
      printResult(args, await clientRequest(space, "/goto", { url }));
      return;
    }
    case "stop":
      printResult(args, await clientRequest(space, "/stop", { keepOpen: Boolean(args.keepOpen) }));
      return;
    default:
      throw new Error(`Unknown daemon command ${args.command}`);
  }
}

loadEnv();
const parsed = parseArgs(process.argv.slice(2));
let fixture;

try {
  if (parsed.command === "serve") {
    const space = await spawnDaemon(parsed);
    console.log(`spaceId=${space.spaceId}  port=${space.port}  ${space.url}`);
    const observed = await clientRequest(space, "/observe", {});
    printResult({ json: parsed.json }, observed);
    process.exit(0);
  }

  if (parsed.command === "run" && !parsed.url) {
    await daemonCommand(parsed);
    process.exit(0);
  }

  if (DAEMON.has(parsed.command)) {
    await daemonCommand(parsed);
    process.exit(0);
  }

  if (parsed.command === "smoke") {
    fixture = await startFixtureServer();
    parsed.fixtureUrl = fixture.url;
    parsed.outputDir = parsed.outputDir ?? resolve("artifacts/smoke/latest");
  }
  if (parsed.command === "flights" && !parsed.outputDir) {
    parsed.outputDir = resolve("artifacts/flights/latest");
  }
  if (parsed.command === "probe" && !parsed.outputDir) {
    parsed.outputDir = resolve("artifacts/probe/latest");
  }
  if (!ONESHOT.has(parsed.command) && parsed.command !== "run") {
    throw new Error(`Unhandled command ${parsed.command}`);
  }
  const code = await runEgo(parsed);
  process.exit(code);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  if (fixture) {
    await fixture.close();
  }
}
