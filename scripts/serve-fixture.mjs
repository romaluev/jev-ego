import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(root, "..", "fixtures", "fixture.html"));

export function startFixtureServer(port = 8766) {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const host = request.headers.host ?? "";
      if (!host.startsWith("127.0.0.1") && !host.startsWith("localhost")) {
        response.writeHead(403);
        response.end("Local fixture only");
        return;
      }
      const path = new URL(request.url ?? "/", `http://${host}`).pathname;
      if (path !== "/" && path !== "/fixture.html") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(fixture);
    });
    server.on("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        resolve({
          server,
          url: `http://127.0.0.1:${port}/fixture.html?scenario=travel`,
          close: async () => {},
        });
        return;
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
      resolve({
        server,
        url: `http://127.0.0.1:${port}/fixture.html?scenario=travel`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const started = await startFixtureServer();
  console.log(started.url);
}
