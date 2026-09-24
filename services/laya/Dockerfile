FROM python:3.11-slim AS exporter

WORKDIR /build

RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install --no-cache-dir \
      "laya==0.3.20" \
      "onnx>=1.17" \
      "onnxscript>=0.2" \
      "onnxruntime>=1.22" \
      "transformers>=4.48" \
      "safetensors>=0.5" \
      "huggingface_hub>=0.20"

COPY export_quantized.py ./
RUN python export_quantized.py /bundle

FROM node:22-slim AS runtime

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY patch_laya.mjs ./
RUN node patch_laya.mjs

COPY server.mjs ./
COPY --from=exporter /bundle ./onnx

ENV NODE_ENV=production
ENV LAYA_MODEL_DIR=/app/onnx

EXPOSE 8000

CMD ["node", "server.mjs"]
