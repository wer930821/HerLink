# HerLink Laya service

HerLink keeps Laya outside the Vercel web app because the model weights are too large for a normal web function.

## Run

```bash
docker build -t herlink-laya .
docker run --rm -p 8000:8000 herlink-laya
```

The service exposes the Jev-compatible endpoint:

```
POST /v1/systemone
```

Set the HerLink Web environment variable:

```
LAYA_BASE_URL=https://your-laya-service.example.com
```

HerLink's `/api/chat-assist` route will automatically use Laya when this variable is present. If the Laya service is unavailable, it falls back to conservative local rules so the chat UI remains usable.

The chat assistant only sends the latest 12 text messages when the user explicitly taps **幫我想怎麼回**. It does not auto-send suggested replies.
