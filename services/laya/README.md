# HerLink Laya service

CPU service for HerLink using the official `@receptron/laya` ONNX runtime.

- `GET /health` reports service/model state.
- `POST /v1/systemone` exposes the decision API used by HerLink.
- Uses Laya's multilingual checkpoint.
- The model loads in the background so Railway health checks can pass while weights are being prepared.
