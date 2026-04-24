FROM node:20-alpine

# Only vips runtime lib needed — no build tools
RUN apk add --no-cache vips

WORKDIR /app
COPY package.json ./

# Install all deps except sharp first
RUN npm install --production --ignore-scripts

# Force-install sharp prebuilt for linux-x64-musl (Alpine)
RUN npm install --cpu=x64 --os=linux --libc=musl sharp

COPY dist/ ./dist/
RUN mkdir -p uploads

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["node", "dist/index.cjs"]
