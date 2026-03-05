FROM python:3.11-slim

# All system deps in one layer — includes Playwright Chromium requirements
RUN apt-get update && apt-get install -y \
    ca-certificates curl \
    # Chromium runtime deps (from playwright install-deps output)
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
    libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxss1 libdbus-1-3 libglib2.0-0 \
    libxshmfence1 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download Chromium browser binary (deps already installed above)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install chromium

COPY . .

EXPOSE 8080
CMD ["python", "main.py"]
