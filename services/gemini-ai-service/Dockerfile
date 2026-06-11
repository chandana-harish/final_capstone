FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY services/gemini-ai-service ./services/gemini-ai-service
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/gemini-ai-service
RUN npm install --omit=dev
CMD ["npm", "start"]
