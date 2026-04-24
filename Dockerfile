FROM node:20-alpine

# Build tools for better-sqlite3 + sharp native modules
RUN apk add --no-cache python3 make g++ vips-dev

WORKDIR /app

COPY package.json ./

# Install production deps + install node-addon-api which sharp needs to build
RUN npm install --production && \
    npm install node-addon-api node-gyp --no-save

COPY dist/ ./dist/
RUN mkdir -p uploads

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["node", "dist/index.cjs"]
