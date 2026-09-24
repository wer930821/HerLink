# HerLink Laya service

Official Laya HTTP server configured for HerLink.

- Uses the official `laya[serve]` package.
- Uses CPU-only PyTorch to avoid installing CUDA packages on Railway.
- Requests explicitly select the `multilingual` checkpoint.
- `GET /health` is used by Railway.
- `POST /v1/systemone` is used by HerLink.
- Bearer authentication is enabled through `LAYA_API_KEY`.
