FROM node:20-alpine AS deps
WORKDIR /app
COPY shared/package.json ./shared/package.json
COPY services/workflow-analyzer-service/package.json ./services/workflow-analyzer-service/package.json
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/workflow-analyzer-service
RUN npm install --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node shared ./shared
COPY --chown=node:node services/workflow-analyzer-service ./services/workflow-analyzer-service
COPY --from=deps --chown=node:node /app/shared/node_modules ./shared/node_modules
COPY --from=deps --chown=node:node /app/services/workflow-analyzer-service/node_modules ./services/workflow-analyzer-service/node_modules
USER node
WORKDIR /app/services/workflow-analyzer-service
CMD ["npm", "start"]
