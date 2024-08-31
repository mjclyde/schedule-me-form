FROM node:20-alpine AS base
ENV NODE_ENV=production
RUN apk --no-cache add curl binutils

WORKDIR /app
COPY ./.npmrc ./
COPY backend/package*.json ./
RUN npm install && npm cache clean --force && rm .npmrc

# DEV
FROM base AS dev
ENV NODE_ENV=development
RUN npm install --only=development
COPY ./backend/ .
COPY ./common ./common

# BUILD
FROM dev AS build
RUN npm run build

# PROD
FROM base AS prod
COPY --from=build /app/dist .
CMD ["node", "src/index.js"]
