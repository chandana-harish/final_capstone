FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY services/webhook-service ./services/webhook-service
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/webhook-service
RUN npm install --omit=dev
EXPOSE 8087
CMD ["npm", "start"]
