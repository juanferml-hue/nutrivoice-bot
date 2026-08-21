FROM node:20-slim

RUN apt-get update && apt-get install -y git openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Generar cliente de Prisma y compilar
RUN npx prisma generate
RUN npm run build

# Iniciar la aplicación directamente
CMD ["npm", "start"]
