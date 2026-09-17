import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { loadEnvFile } from "../src/env.js";

afterEach(() => {
  delete process.env.JEV_ENV_TEST_KEY;
});

test("loadEnvFile fills empty env vars from a file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-env-"));
  const path = join(dir, ".env");
  await writeFile(path, "JEV_ENV_TEST_KEY=hello\n");
  process.env.JEV_ENV_TEST_KEY = "";
  loadEnvFile(path);
  expect(process.env.JEV_ENV_TEST_KEY).toBe("hello");
});
