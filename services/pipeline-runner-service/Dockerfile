FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY services/pipeline-runner-service ./services/pipeline-runner-service
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/pipeline-runner-service
RUN npm install --omit=dev
CMD ["npm", "start"]
