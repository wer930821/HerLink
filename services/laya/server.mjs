import http from "node:http";
import { Laya } from "@receptron/laya";

const port = Number(process.env.PORT || 8000);
const apiKey = process.env.LAYA_API_KEY || "";

let model = null;
let modelError = null;
let loading = true;
let lastInferenceError = null;
let lastInferenceAt = null;
let lastInferenceOkAt = null;

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
  if (req.method === "GET" && (req.url === "/health" || req.url === "/docs")) {
    const degraded = Boolean(model && lastInferenceError && (!lastInferenceOkAt || lastInferenceAt > lastInferenceOkAt));
    return sendJson(res, model ? 200 : loading ? 200 : 503, {
      ok: Boolean(model) && !degraded,
      state: model ? (degraded ? "degraded" : "ready") : loading ? "loading" : "error",
      error: modelError,
      inference_error: degraded ? lastInferenceError : null,
      last_inference_at: lastInferenceAt,
      last_inference_ok_at: lastInferenceOkAt,
    });
  }

  if (req.method === "GET" && req.url === "/selftest") {
    if (!model) {
      return sendJson(res, 503, {
        ok: false,
        error: loading ? "Laya model is loading" : "Laya model unavailable",
        detail: modelError,
      });
    }

    try {
      const startedAt = Date.now();
      const result = await model.systemOne(
        { conversation: "對方：今天工作有點累。\n我：辛苦了。" },
        {
          next_move: {
            type: "choice",
            instructions: "下一步最適合如何回應？",
            criteria: {
              empathize: "先同理對方",
              ask_open_question: "問一個容易回答的問題",
              change_topic: "換一個輕鬆話題",
            },
          },
          safety_risk: {
            type: "noul",
            instructions: "這段聊天是否有明顯詐騙或金錢風險？",
          },
        }
      );
      lastInferenceAt = new Date().toISOString();
      lastInferenceOkAt = lastInferenceAt;
      lastInferenceError = null;
      return sendJson(res, 200, {
        ok: true,
        latency_ms: Date.now() - startedAt,
        model: result?.model ?? "laya",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastInferenceAt = new Date().toISOString();
      lastInferenceError = message.slice(0, 500);
      console.error("[laya] selftest failed:", message);
      return sendJson(res, 500, { ok: false, error: message });
    }
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
      lastInferenceAt = new Date().toISOString();
      lastInferenceOkAt = lastInferenceAt;
      lastInferenceError = null;
      return sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastInferenceAt = new Date().toISOString();
      lastInferenceError = message.slice(0, 500);
      console.error("[laya] systemOne failed:", message);
      return sendJson(res, 500, {
        error: message,
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
