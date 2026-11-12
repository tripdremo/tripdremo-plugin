FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY mcp/package.json mcp/tsconfig.json ./mcp/
RUN npm ci
COPY mcp/src ./mcp/src
RUN npm run build -w mcp && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/mcp ./mcp
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "require('node:http').get('http://127.0.0.1:3000/health',{headers:{Host:'mcp.tripdremo.com'}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "mcp/dist/http.js"]
