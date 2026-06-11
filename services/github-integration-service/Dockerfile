FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY services/github-integration-service ./services/github-integration-service
WORKDIR /app/services/github-integration-service
RUN npm install --omit=dev
EXPOSE 8082
CMD ["npm", "start"]

