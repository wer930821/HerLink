FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    USE_TF=0 \
    LAYA_DEVICE=cpu \
    LAYA_PRELOAD=0 \
    LAYA_MODELS=multilingual \
    LAYA_THREADS=2 \
    LAYA_HOST=0.0.0.0

RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install --no-cache-dir "laya[serve]==0.3.20"

EXPOSE 8000

CMD ["sh", "-c", "LAYA_PORT=${PORT:-8000} laya-serve"]
