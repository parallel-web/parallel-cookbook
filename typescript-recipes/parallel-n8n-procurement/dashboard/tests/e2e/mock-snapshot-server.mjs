import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.SNAPSHOT_MOCK_PORT || 4111);
const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "snapshot.json");

const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.url === "/snapshot") {
    const fixture = await readFile(fixturePath, "utf8");
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-type": "application/json",
    });
    response.end(fixture);
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`snapshot mock listening on ${port}\n`);
});
