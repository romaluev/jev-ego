import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Agent } from "./agent.js";
import { EgoBrowser } from "./browser.js";
import { loadEnvFile } from "./env.js";
import { formatTable } from "./format.js";
import { startDaemon } from "./server.js";
import { Session } from "./session.js";
import type { AgentSnapshot, JevArgs, JevCommand } from "./types.js";
import { assertNever } from "./assert.js";
import { FLIGHTS_GOAL, FLIGHTS_URL, verifyFlights } from "./verify/flights.js";

declare global {
  var __jevArgs: JevArgs | undefined;
}

const SMOKE_GOAL =
  "Use the destination search and filters to find Design stays in Lisbon with Free cancellation, " +
  "then open Casa Flora.";

function args(): JevArgs {
  const value = globalThis.__jevArgs;
  if (!value) {
    throw new Error("jev-ego must be launched through bin/jev-ego.mjs");
  }
  loadEnvFile(value.envPath);
  return value;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true }).catch(() => undefined);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function persist(dir: string | undefined, name: string, value: unknown): Promise<void> {
  if (!dir) {
    return;
  }
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, name), value);
}

function profileId(requested: string | undefined): string {
  return requested || process.env.JEV_PROFILE_ID || "Profile 4";
}

async function runAgent(input: {
  url: string;
  goal: string;
  keepOpen?: boolean;
  outputDir?: string;
}): Promise<{ session: Session; last: AgentSnapshot }> {
  if (!process.env.TYPESAFE_API_KEY) {
    throw new Error("TYPESAFE_API_KEY is required; no action executed.");
  }
  const session = await Session.open({
    url: input.url,
    goal: input.goal,
    profileId: profileId(args().profileId),
  });
  let last = session.observe();
  try {
    last = await session.run(60);
    await persist(input.outputDir, "state.json", last);
    for (const entry of last.history) {
      console.log(`${entry.elapsed_ms} ms  ${entry.step} actions  ${last.status}  ${entry.action}`);
    }
  } catch (error) {
    await persist(input.outputDir, "state.json", { ...session.observe(), error: String(error) });
    throw error;
  }
  return { session, last };
}

async function command(name: JevCommand): Promise<void> {
  const options = args();
  switch (name) {
    case "serve": {
      const url = options.url;
      if (!url) {
        throw new Error("serve requires --url");
      }
      const goal = options.goals?.[0] ?? "Observe and act on the current page.";
      const session = await Session.open({
        url,
        goal,
        profileId: profileId(options.profileId),
      });
      const listening = await startDaemon(session, {
        registryDir: options.registryDir,
        serveToken: options.serveToken,
      });
      console.log(
        JSON.stringify({
          spaceId: listening.spaceId,
          port: listening.port,
          url: session.agent.state.page.url,
        }),
      );
      console.log(formatTable(session.observe()));
      return;
    }
    case "run": {
      const url = options.url;
      const goals = options.goals ?? [];
      if (!url || goals.length === 0) {
        throw new Error("run requires --url and --goal");
      }
      const { session, last } = await runAgent({
        url,
        goal: goals.join("\n"),
        keepOpen: options.keepOpen,
        outputDir: options.traceDir,
      });
      console.log(last.page.url);
      await session.stop(options.keepOpen);
      return;
    }
    case "flights": {
      const outputDir = options.outputDir ?? options.traceDir;
      const { session, last } = await runAgent({
        url: FLIGHTS_URL,
        goal: FLIGHTS_GOAL,
        keepOpen: options.keepOpen,
        outputDir,
      });
      const verification = verifyFlights(last.page);
      const snapshot = { ...last, verification, protocol_calls: last.protocol_calls };
      await persist(outputDir, "state.json", snapshot);
      console.log(JSON.stringify(verification, null, 2));
      if (!verification.passed) {
        console.error("Final page did not satisfy the route/date checks");
        console.error(`Inspect spaceId=${session.browser.spaceId}; task space was not finished.`);
        process.exitCode = 1;
        return;
      }
      await session.stop(options.keepOpen);
      return;
    }
    case "probe": {
      const url = options.url ?? options.fixtureUrl ?? "https://example.com/";
      const browser = await EgoBrowser.open(url, profileId(options.profileId));
      const page = await browser.observe();
      const agent = new Agent({ browser, page, goal: "probe" });
      const summary = {
        space_id: browser.spaceId,
        url: page.url,
        title: page.title,
        actions: page.actions.length,
        omitted_actions: page.omitted_actions ?? 0,
        protocol_calls: browser.protocolCalls,
        fingerprint: page.fingerprint,
      };
      await persist(options.outputDir ?? options.traceDir, "probe.json", summary);
      console.log(JSON.stringify(summary, null, 2));
      console.log(formatTable(agent.snapshot()));
      await browser.close(options.keepOpen);
      return;
    }
    case "smoke": {
      const url = options.fixtureUrl;
      if (!url) {
        throw new Error("smoke requires a fixture URL from the launcher");
      }
      const outputDir = options.outputDir ?? options.traceDir;
      const { session, last } = await runAgent({
        url,
        goal: SMOKE_GOAL,
        keepOpen: options.keepOpen,
        outputDir,
      });
      const verificationText =
        typeof session.browser.evaluate === "function"
          ? String(await session.browser.evaluate("document.body.innerText"))
          : last.page.text;
      const verified =
        last.status === "done" &&
        last.page.url.endsWith("#casa-flora") &&
        verificationText.includes(
          "Your filters: Design · Free cancellation enabled · Destination Lisbon",
        );
      const summary = {
        ms: last.elapsed_ms,
        verified,
        decisions: last.decisions.length,
        actions: last.history.length,
        protocol_calls: last.protocol_calls,
        url: last.page.url,
      };
      await persist(outputDir, "state.json", { ...last, verification_text: verificationText, summary });
      await persist(outputDir, "summary.json", summary);
      console.log(JSON.stringify(summary, null, 2));
      if (!verified) {
        console.error("Fixture smoke did not satisfy the independent checks");
        console.error(`Inspect spaceId=${session.browser.spaceId}; task space was not finished.`);
        process.exitCode = 1;
        return;
      }
      await session.stop(options.keepOpen);
      return;
    }
    default:
      assertNever(name, "command");
  }
}

const requested = args();
try {
  await command(requested.command);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
