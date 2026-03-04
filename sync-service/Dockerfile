FROM python:3.11-slim

RUN apt-get update && apt-get install -y ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# No local Chromium needed — we connect to Airtop's cloud browser via CDP
# Just install the Playwright library (for CDP protocol support)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY . .

EXPOSE 8080
CMD ["python", "main.py"]
