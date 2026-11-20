import http from "node:http";

export interface ElicitationBridge {
  origin: string;
  register: (token: string, handler: (request: unknown) => Promise<unknown>) => void;
  close: () => Promise<void>;
}

/** Loopback endpoint the MCP shim calls when the server asks for operator input. */
export function startElicitationBridge(): Promise<ElicitationBridge> {
  const handlers = new Map<string, (request: unknown) => Promise<unknown>>();
  const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url === "/tool-result") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            token?: string;
            result?: unknown;
          };
          const handler =
            typeof body.token === "string" ? handlers.get(`result:${body.token}`) : undefined;
          handler?.(body.result);
        } catch {
          /* ignore malformed result */
        }
        response.writeHead(200).end();
      });
      return;
    }
    if (request.method !== "POST" || request.url !== "/elicit") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            token?: string;
            request?: unknown;
          };
          const handler = typeof body.token === "string" ? handlers.get(body.token) : undefined;
          const result = handler ? await handler(body.request) : { action: "decline" };
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(result));
        } catch {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ action: "decline" }));
        }
      })();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Elicitation bridge did not bind a port"));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        register: (token, handler) => handlers.set(token, handler),
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
