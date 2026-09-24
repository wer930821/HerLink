import http from "node:http";
import { Laya } from "@receptron/laya";

const port = Number(process.env.PORT || 8000);
const apiKey = process.env.LAYA_API_KEY || "";

let model = null;
let modelError = null;
let loading = true;

async function loadModel() {
  try {
    model = await Laya.load({
      modelDir: process.env.LAYA_MODEL_DIR || "/app/onnx",
      executionProviders: ["cpu"],
      sessionOptions: {
        intraOpNumThreads: 2,
        interOpNumThreads: 1,
      },
    });
    console.log("[laya] multilingual INT8 model ready");
  } catch (error) {
    modelError = error instanceof Error ? error.message : String(error);
    console.error("[laya] model load failed:", modelError);
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
    if (body.length > 256000) throw new Error("Request too large");
  }
  return JSON.parse(body || "{}");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, model ? 200 : loading ? 200 : 503, {
      ok: Boolean(model),
      state: model ? "ready" : loading ? "loading" : "error",
      error: modelError,
    });
  }

  if (req.method === "POST" && req.url === "/v1/systemone") {
    if (apiKey && req.headers.authorization !== `Bearer ${apiKey}`) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    if (!model) {
      return sendJson(res, 503, {
        error: loading ? "Laya model is loading" : "Laya model unavailable",
        detail: modelError,
      });
    }

    try {
      const payload = await readJson(req);
      const result = await model.systemOne(payload?.state ?? {}, payload?.questions ?? {});
      return sendJson(res, 200, result);
    } catch (error) {
      return sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return sendJson(res, 404, { error: "Not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`HerLink Laya INT8 service listening on :${port}`);
  void loadModel();
});

async function shutdown() {
  try {
    await model?.close?.();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
