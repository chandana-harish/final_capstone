FROM node:20-alpine AS deps
WORKDIR /app
COPY shared/package.json ./shared/package.json
COPY services/auth-service/package.json ./services/auth-service/package.json
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/auth-service
RUN npm install --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node shared ./shared
COPY --chown=node:node services/auth-service ./services/auth-service
COPY --from=deps --chown=node:node /app/shared/node_modules ./shared/node_modules
COPY --from=deps --chown=node:node /app/services/auth-service/node_modules ./services/auth-service/node_modules
USER node
WORKDIR /app/services/auth-service
EXPOSE 8081
CMD ["npm", "start"]
