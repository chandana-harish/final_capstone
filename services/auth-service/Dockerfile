FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY services/auth-service ./services/auth-service
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/auth-service
RUN npm install --omit=dev
EXPOSE 8081
CMD ["npm", "start"]
