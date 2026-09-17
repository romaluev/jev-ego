export interface EgoProfile {
  id: string;
  name?: string;
}

export interface EgoPage {
  label: string;
  spaceId: number;
  cdp(method: string, params?: Record<string, unknown>, options?: { timeout?: number }): Promise<unknown>;
  goto(
    url: string,
    options?: { referer?: string; timeout?: number; waitUntil?: string },
  ): Promise<unknown>;
  url(): Promise<string>;
  evaluate(fnOrString: string | ((arg: unknown) => unknown), argument?: unknown): Promise<unknown>;
}

export interface EgoTaskSpace {
  spaceId: number;
  name: string;
  ownership: string;
  page(label: string): EgoPage;
  finish(options: { keep: string[] | "all" }): Promise<unknown>;
}

interface EgoGlobals {
  taskSpace: (nameOrId: string | number, options?: { profileId?: string }) => Promise<EgoTaskSpace>;
  profiles: () => Promise<Array<EgoProfile | string>>;
}

function ego(): EgoGlobals {
  return globalThis as unknown as EgoGlobals;
}

export async function openTaskSpace(name: string, profileId: string): Promise<EgoTaskSpace> {
  return await ego().taskSpace(name, { profileId });
}

export async function listProfiles(): Promise<Array<EgoProfile | string>> {
  return await ego().profiles();
}
