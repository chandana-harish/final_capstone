FROM node:20-alpine AS deps
WORKDIR /app
COPY shared/package.json ./shared/package.json
COPY services/github-integration-service/package.json ./services/github-integration-service/package.json
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/github-integration-service
RUN npm install --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node shared ./shared
COPY --chown=node:node services/github-integration-service ./services/github-integration-service
COPY --from=deps --chown=node:node /app/shared/node_modules ./shared/node_modules
COPY --from=deps --chown=node:node /app/services/github-integration-service/node_modules ./services/github-integration-service/node_modules
USER node
WORKDIR /app/services/github-integration-service
EXPOSE 8082
CMD ["npm", "start"]
