FROM node:20-alpine AS deps
WORKDIR /app
COPY shared/package.json ./shared/package.json
COPY services/gemini-ai-service/package.json ./services/gemini-ai-service/package.json
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/gemini-ai-service
RUN npm install --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node shared ./shared
COPY --chown=node:node services/gemini-ai-service ./services/gemini-ai-service
COPY --from=deps --chown=node:node /app/shared/node_modules ./shared/node_modules
COPY --from=deps --chown=node:node /app/services/gemini-ai-service/node_modules ./services/gemini-ai-service/node_modules
USER node
WORKDIR /app/services/gemini-ai-service
CMD ["npm", "start"]
