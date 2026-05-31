FROM python:3.11-bookworm

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install --no-cache-dir litert-lm

WORKDIR /app

COPY scripts/litert_bridge.py /opt/sc/litert_bridge.py
COPY scripts/litert_preset.py /opt/sc/litert_preset.py
