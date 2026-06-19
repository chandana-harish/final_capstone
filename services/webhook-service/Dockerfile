FROM node:20-alpine AS deps
WORKDIR /app
COPY shared/package.json ./shared/package.json
COPY services/webhook-service/package.json ./services/webhook-service/package.json
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/webhook-service
RUN npm install --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node shared ./shared
COPY --chown=node:node services/webhook-service ./services/webhook-service
COPY --from=deps --chown=node:node /app/shared/node_modules ./shared/node_modules
COPY --from=deps --chown=node:node /app/services/webhook-service/node_modules ./services/webhook-service/node_modules
USER node
WORKDIR /app/services/webhook-service
EXPOSE 8087
CMD ["npm", "start"]
