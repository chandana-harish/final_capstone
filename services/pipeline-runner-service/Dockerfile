FROM node:20-alpine AS deps
WORKDIR /app
COPY shared/package.json ./shared/package.json
COPY services/pipeline-runner-service/package.json ./services/pipeline-runner-service/package.json
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/pipeline-runner-service
RUN npm install --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node shared ./shared
COPY --chown=node:node services/pipeline-runner-service ./services/pipeline-runner-service
COPY --from=deps --chown=node:node /app/shared/node_modules ./shared/node_modules
COPY --from=deps --chown=node:node /app/services/pipeline-runner-service/node_modules ./services/pipeline-runner-service/node_modules
USER node
WORKDIR /app/services/pipeline-runner-service
CMD ["npm", "start"]
