FROM node:20-alpine

# Build deps for better-sqlite3 and sharp
RUN apk add --no-cache python3 make g++ vips-dev

WORKDIR /app

# Install all runtime deps (including native module rebuilds for this arch/Node version)
COPY package.json ./
RUN npm install --production

# Copy built server bundle and frontend
COPY dist/ ./dist/

# Uploads dir
RUN mkdir -p uploads

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/index.cjs"]
