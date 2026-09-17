import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { authorize } from "../src/server.js";
import { listRegistry, removeRegistry, writeRegistry } from "../src/registry.js";

test("server auth rejects a missing token", () => {
  const result = authorize("127.0.0.1:9", undefined, "secret");
  expect(result).toEqual({ ok: false, status: 403, error: "Unauthorized" });
});

test("server auth rejects the wrong Host", () => {
  const result = authorize("example.com", "secret", "secret");
  expect(result).toEqual({ ok: false, status: 403, error: "Local demo requests only" });
});

test("server auth accepts loopback plus token", () => {
  expect(authorize("127.0.0.1:8123", "secret", "secret")).toEqual({ ok: true });
});

test("registry write and remove", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-ego-"));
  const entry = {
    spaceId: 42,
    port: 9,
    token: "t",
    pid: 1,
    url: "https://example.com/",
    goal: "g",
    startedAt: "now",
  };
  await writeRegistry(dir, entry);
  expect(JSON.parse(await readFile(join(dir, "42.json"), "utf8")).spaceId).toBe(42);
  expect(await listRegistry(dir)).toHaveLength(1);
  await removeRegistry(dir, 42);
  expect(await listRegistry(dir)).toHaveLength(0);
});
