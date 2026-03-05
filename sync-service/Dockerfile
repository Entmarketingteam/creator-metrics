FROM python:3.11-slim

# System deps for Chromium (used by Amazon sync)
RUN apt-get update && apt-get install -y \
    ca-certificates curl \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Chromium for local Playwright (used by Amazon sync — no Airtop needed)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install chromium
RUN playwright install-deps chromium

COPY . .

EXPOSE 8080
CMD ["python", "main.py"]
