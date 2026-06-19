FROM node:20-alpine AS deps
WORKDIR /app
COPY shared/package.json ./shared/package.json
COPY services/dashboard-api/package.json ./services/dashboard-api/package.json
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/dashboard-api
RUN npm install --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node shared ./shared
COPY --chown=node:node services/dashboard-api ./services/dashboard-api
COPY --from=deps --chown=node:node /app/shared/node_modules ./shared/node_modules
COPY --from=deps --chown=node:node /app/services/dashboard-api/node_modules ./services/dashboard-api/node_modules
USER node
WORKDIR /app/services/dashboard-api
EXPOSE 8080
CMD ["npm", "start"]
