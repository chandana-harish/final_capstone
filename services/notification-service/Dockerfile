FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY services/notification-service ./services/notification-service
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/notification-service
RUN npm install --omit=dev
CMD ["npm", "start"]
