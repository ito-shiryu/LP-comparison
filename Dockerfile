FROM mcr.microsoft.com/playwright:v1.43.0-jammy

WORKDIR /app

COPY package*.json ./
# postinstall で playwright install が走るが、イメージ内に既にある → スキップ
RUN npm ci --ignore-scripts

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
