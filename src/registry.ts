import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { RegistryEntry } from "./types.js";

export function defaultRegistryDir(): string {
  return join(homedir(), ".jev-ego", "spaces");
}

export function registryPath(dir: string, spaceId: number): string {
  return join(dir, `${spaceId}.json`);
}

export async function writeRegistry(dir: string, entry: RegistryEntry): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = registryPath(dir, entry.spaceId);
  await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`);
  return path;
}

export async function removeRegistry(dir: string, spaceId: number): Promise<void> {
  try {
    await unlink(registryPath(dir, spaceId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function readRegistry(dir: string, spaceId: number): Promise<RegistryEntry | null> {
  try {
    return JSON.parse(await readFile(registryPath(dir, spaceId), "utf8")) as RegistryEntry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function listRegistry(dir: string): Promise<RegistryEntry[]> {
  try {
    const names = await readdir(dir);
    const entries: RegistryEntry[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const raw = await readFile(join(dir, name), "utf8");
      entries.push(JSON.parse(raw) as RegistryEntry);
    }
    return entries.sort((left, right) => left.spaceId - right.spaceId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function findRegistryByToken(dir: string, serveToken: string): Promise<RegistryEntry | null> {
  const entries = await listRegistry(dir);
  return entries.find((entry) => entry.serveToken === serveToken) ?? null;
}
