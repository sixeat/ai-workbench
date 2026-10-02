FROM node:24-bookworm-slim

WORKDIR /app

ARG VITE_PROXY_URL=/
ENV VITE_PROXY_URL=${VITE_PROXY_URL}

COPY package*.json ./
RUN npm ci --include=dev

COPY . ./
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "server/index.cjs"]
