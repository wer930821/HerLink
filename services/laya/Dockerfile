FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    USE_TF=0 \
    LAYA_DEVICE=cpu \
    LAYA_PRELOAD=1

RUN pip install --no-cache-dir "laya[serve]==0.3.13"

EXPOSE 8000

CMD ["laya-serve", "--host", "0.0.0.0", "--port", "8000"]
