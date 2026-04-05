FROM node:20-alpine

# vips is needed by sharp (pre-built binary — no compilation required)
RUN apk add --no-cache vips-dev

WORKDIR /app

# Install runtime deps — sharp uses pre-built binaries for linux-x64-musl
COPY package.json ./
RUN npm install --production --ignore-scripts && \
    npm install sharp --ignore-scripts=false

# Copy built server and frontend
COPY dist/ ./dist/

# Uploads dir for extracted wine images
RUN mkdir -p uploads

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/index.cjs"]
