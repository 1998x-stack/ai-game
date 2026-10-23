FROM mcr.microsoft.com/playwright:v1.60.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY sandbox/worker.cjs /app/sandbox/worker.cjs
RUN chmod -R a+rX /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER 10001:10001
ENTRYPOINT ["node", "/app/sandbox/worker.cjs"]
