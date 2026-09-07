FROM node:22-alpine

WORKDIR /app

COPY mcp/package.json mcp/package-lock.json* ./mcp/
RUN cd mcp && npm ci --omit=dev && npm cache clean --force

COPY api ./api
COPY frontend/src/lib ./frontend/src/lib
COPY frontend/src/instr ./frontend/src/instr
COPY mcp ./mcp

WORKDIR /app/mcp

ENV OPENGYM_DATA=/data
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_HTTP_PORT=3010

EXPOSE 3010

CMD ["node", "src/http.js"]
