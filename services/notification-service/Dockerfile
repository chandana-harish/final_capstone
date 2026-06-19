FROM node:20-alpine AS deps
WORKDIR /app
COPY shared/package.json ./shared/package.json
COPY services/notification-service/package.json ./services/notification-service/package.json
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/notification-service
RUN npm install --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node shared ./shared
COPY --chown=node:node services/notification-service ./services/notification-service
COPY --from=deps --chown=node:node /app/shared/node_modules ./shared/node_modules
COPY --from=deps --chown=node:node /app/services/notification-service/node_modules ./services/notification-service/node_modules
USER node
WORKDIR /app/services/notification-service
CMD ["npm", "start"]
