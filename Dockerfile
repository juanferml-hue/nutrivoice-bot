FROM node:18-slim

# Instalar Chromium nativo de Debian/Ubuntu y dependencias
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Definir la variable para que Puppeteer use Chromium nativo
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "start"]
