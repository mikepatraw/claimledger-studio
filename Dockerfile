FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    CLAIMLEDGER_PROVIDER=heuristic-only \
    CLAIMLEDGER_PRIVACY_MODE=heuristic_only \
    CLAIMLEDGER_DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /data/uploads /data/exports /data/audit /data/db

EXPOSE 4173
VOLUME ["/data"]
CMD ["npm", "run", "start"]
