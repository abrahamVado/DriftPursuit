# syntax=docker/dockerfile:1

FROM python:3.11-slim AS builder
WORKDIR /app
ENV PIP_NO_CACHE_DIR=1 PIP_ROOT_USER_ACTION=ignore

# toolchain for native wheels
RUN apt-get update \
 && apt-get install --no-install-recommends -y build-essential \
 && rm -rf /var/lib/apt/lists/*

# copy only dep files first for better cache hits (optional but recommended)
COPY requirements.txt* pyproject.toml* setup.cfg* setup.py* ./

# make sure /install exists and install deps into it
RUN mkdir -p /install && \
    if [ -f requirements.txt ]; then \
      python -m pip install --prefix=/install -r requirements.txt; \
    elif [ -f pyproject.toml ]; then \
      python -m pip install --prefix=/install .; \
    else \
      echo "No requirements.txt or pyproject.toml found in /app" >&2; exit 1; \
    fi

# if you need package code at build time (for editable installs), copy now:
COPY . .

FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

# bring in site-packages and console scripts
COPY --from=builder /install /usr/local

# app source
COPY . .

# non-root user
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000
CMD ["python", "-m", "bot_runner"]
