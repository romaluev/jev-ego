export async function postJson(url: string, key: string, body: unknown): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new Error("Model connection failed; no action executed.");
    }
    if ((response.status === 429 || response.status === 529 || response.status === 503) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    if (!response.ok) {
      throw new Error(`Model provider returned HTTP ${response.status}; no action executed.`);
    }
    return await response.json();
  }
  throw new Error("Model unavailable");
}
