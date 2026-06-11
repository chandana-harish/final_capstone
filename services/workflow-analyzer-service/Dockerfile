FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY services/workflow-analyzer-service ./services/workflow-analyzer-service
WORKDIR /app/services/workflow-analyzer-service
RUN npm install --omit=dev
CMD ["npm", "start"]

