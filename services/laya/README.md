# HerLink Laya service

Railway Hobby has a 1 GB per-replica memory ceiling. The upstream PyTorch multilingual checkpoint exceeds that during load, so this service exports the official multilingual checkpoint during the Docker build and dynamically quantizes its ONNX weights to INT8.

Runtime:
- official Laya multilingual model semantics
- ONNX Runtime on CPU
- Bearer auth via `LAYA_API_KEY`
- `GET /health`
- `POST /v1/systemone`

The heavy PyTorch toolchain exists only in the Docker build stage and is not present in the runtime image.
