# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

COPY frontend/ .
RUN pnpm build

# ── Stage 2: Python application ───────────────────────────────────────────────
FROM python:3.12-slim

# Install psycopg2 build deps (needed by Alembic sync driver)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install uv --no-cache-dir

WORKDIR /app

# Install Python dependencies
COPY pyproject.toml ./
RUN uv pip install --system -e .

# Install psycopg2 for Alembic (sync migrations)
RUN pip install psycopg2-binary --no-cache-dir

# Copy application code
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./

# Copy built frontend
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

CMD ["python", "-m", "app.main"]
