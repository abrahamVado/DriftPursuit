# syntax=docker/dockerfile:1

FROM python:3.11-slim AS builder
WORKDIR /app
ENV PIP_NO_CACHE_DIR=1
RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN if [ -f requirements.txt ]; then \
        pip install --prefix=/install -r requirements.txt; \
    elif [ -f pyproject.toml ]; then \
        pip install --prefix=/install .; \
    fi

FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY --from=builder /install /usr/local
COPY . .
RUN useradd --create-home --uid 10001 appuser
USER appuser
EXPOSE 8000
CMD ["python", "-m", "bot_runner"]
