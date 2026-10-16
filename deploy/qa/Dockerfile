FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
RUN git config --system --add safe.directory /app
COPY backend/requirements-dev.txt /tmp/requirements-dev.txt
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements-dev.txt && pip check
WORKDIR /app/backend
CMD ["python", "tests/qa_runner.py"]
