import http from "node:http";
import { Laya } from "@receptron/laya";

const port = Number(process.env.PORT || 8000);
const token = process.env.LAYA_API_TOKEN || "";

let laya = null;
let loading = false;
let loadError = null;

async function ensureLoaded() {
  if (laya) return laya;
  if (loading) return null;

  loading = true;
  loadError = null;

  try {
    laya = await Laya.load({
      subfolder: "multilingual",
      cacheDir: process.env.LAYA_CACHE || "/app/.cache/laya",
      executionProviders: ["cpu"],
    });
    return laya;
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    loading = false;
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  res.end(data);
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 256_000) {
      throw new Error("Request too large");
    }
  }
  return JSON.parse(body || "{}");
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, {
        ok: true,
        model: laya ? "ready" : loading ? "loading" : loadError ? "error" : "starting",
        error: loadError,
      });
    }

    if (req.method === "POST" && req.url === "/v1/systemone") {
      if (token) {
        const auth = req.headers.authorization || "";
        if (auth !== `Bearer ${token}`) {
          return sendJson(res, 401, { error: "Unauthorized" });
        }
      }

      const model = laya || await ensureLoaded();
      if (!model) {
        return sendJson(res, 503, {
          error: "Laya model is still loading",
          detail: loadError,
        });
      }

      const payload = await readJson(req);
      const state = payload?.state ?? {};
      const questions = payload?.questions ?? {};

      const result = await model.systemOne(state, questions);
      return sendJson(res, 200, result);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`HerLink Laya service listening on :${port}`);
  void ensureLoaded().then(() => {
    if (laya) console.log("Laya multilingual model ready");
    else console.error("Laya load failed:", loadError);
  });
});

async function shutdown() {
  try {
    await laya?.close?.();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
