import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { formatDirections, formatTable } from "./format.js";
import { defaultRegistryDir, removeRegistry, writeRegistry } from "./registry.js";
import { BusyError, type Session } from "./session.js";
import type { RegistryEntry } from "./types.js";

export interface AuthFailure {
  ok: false;
  status: number;
  error: string;
}

export function authorize(
  host: string | undefined,
  providedToken: string | undefined,
  token: string,
): { ok: true } | AuthFailure {
  const hostname = (host ?? "").split(":")[0];
  if (hostname !== "127.0.0.1") {
    return { ok: false, status: 403, error: "Local demo requests only" };
  }
  if (!providedToken || providedToken !== token) {
    return { ok: false, status: 403, error: "Unauthorized" };
  }
  return { ok: true };
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON object body required");
  }
  return parsed as Record<string, unknown>;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

export async function startDaemon(
  session: Session,
  options: { registryDir?: string; serveToken?: string } = {},
): Promise<{ port: number; token: string; spaceId: number }> {
  const token = randomBytes(32).toString("base64url");
  const registryDir = options.registryDir ?? defaultRegistryDir();
  const resolvedSpaceId = session.browser.spaceId;
  if (typeof resolvedSpaceId !== "number") {
    throw new Error("Task space id missing");
  }
  const spaceId: number = resolvedSpaceId;
  let entry: RegistryEntry | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const server = createServer((request, response) => {
    void (async () => {
      const auth = authorize(request.headers.host, header(request, "x-jev-token"), token);
      if (!auth.ok) {
        send(response, auth.status, { error: auth.error });
        return;
      }
      const path = (request.url ?? "/").split("?")[0] ?? "/";
      try {
        const body = request.method === "GET" ? {} : await readBody(request);
        const result = await dispatch(session, path, body);
        send(response, 200, result);
        if (path === "/stop") {
          await shutdown();
        }
      } catch (error) {
        if (error instanceof BusyError) {
          send(response, 409, { error: error.message });
          return;
        }
        const status = error instanceof Error && error.message.includes("required") ? 400 : 400;
        const message = error instanceof Error ? error.message : String(error);
        send(response, status, { error: message });
      }
    })();
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind loopback port"));
        return;
      }
      resolve(address.port);
    });
  });

  entry = {
    spaceId,
    port,
    token,
    pid: process.pid,
    url: session.agent.state.page.url,
    goal: session.agent.state.goal,
    startedAt: new Date().toISOString(),
    serveToken: options.serveToken,
  };
  await writeRegistry(registryDir, entry);
  await mkdir(registryDir, { recursive: true });
  await appendFile(
    join(registryDir, `${spaceId}.log`),
    `listening 127.0.0.1:${port} spaceId=${spaceId}\n`,
  );
  heartbeat = setInterval(() => undefined, 30_000);
  heartbeat.unref();

  async function shutdown(): Promise<void> {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    await removeRegistry(registryDir, spaceId);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exitCode = 0;
    setTimeout(() => process.exit(0), 10).unref();
  }

  return { port, token, spaceId };
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export async function dispatch(
  session: Session,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (path) {
    case "/observe":
    case "/state": {
      const snapshot = session.observe();
      return {
        snapshot,
        text: formatTable(snapshot, { full: Boolean(body.full) }),
      };
    }
    case "/act": {
      const operation = String(body.operation ?? "");
      const target = body.target === undefined || body.target === null ? undefined : String(body.target);
      const text = body.text === undefined || body.text === null ? undefined : String(body.text);
      const snapshot = await session.actManual(operation, target, text);
      return { snapshot, text: formatTable(snapshot) };
    }
    case "/suggest": {
      const top = typeof body.top === "number" ? body.top : 8;
      const goal = typeof body.goal === "string" ? body.goal : undefined;
      const result = await session.suggest(goal, top);
      return {
        ...result,
        text: `${formatTable(result.snapshot)}\n\n${formatDirections(result.directions, { confidence: result.decision.confidence })}`,
      };
    }
    case "/step": {
      const goal = typeof body.goal === "string" ? body.goal : undefined;
      const result = await session.step(goal);
      return {
        ...result,
        text: result.pending
          ? `${formatTable(result.snapshot)}\n\n${result.reason ?? ""}`
          : formatTable(result.snapshot),
      };
    }
    case "/run": {
      const goal = typeof body.goal === "string" ? body.goal : undefined;
      const maxSteps = typeof body.maxSteps === "number" ? body.maxSteps : 20;
      const snapshot = await session.run(maxSteps, goal);
      return { snapshot, text: formatTable(snapshot) };
    }
    case "/goto": {
      const url = String(body.url ?? "");
      if (!url) {
        throw new Error("goto requires url");
      }
      const snapshot = await session.goto(url);
      return { snapshot, text: formatTable(snapshot) };
    }
    case "/stop": {
      await session.stop(Boolean(body.keepOpen));
      return { stopped: true };
    }
    default:
      throw new Error(`Unknown route ${path}`);
  }
}
