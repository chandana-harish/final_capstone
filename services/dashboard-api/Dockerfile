FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY services/dashboard-api ./services/dashboard-api
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/services/dashboard-api
RUN npm install --omit=dev
EXPOSE 8080
CMD ["npm", "start"]
