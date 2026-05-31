FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=4001

EXPOSE 4001

CMD ["node", "src/index.js"]
