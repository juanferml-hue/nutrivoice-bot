FROM node:18
# Instalamos los componentes necesarios para que el navegador de WhatsApp funcione
RUN apt-get update && apt-get install -y \
    libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm-dev libasound2 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "start"]
