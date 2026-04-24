FROM node:20-alpine
RUN apk add --no-cache python3 make g++ vips-dev
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY dist/ ./dist/
RUN mkdir -p uploads
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["node", "dist/index.cjs"]
