FROM node:20-slim

RUN apt-get update && apt-get install -y git openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Generar cliente de Prisma y compilar TypeScript
RUN npx prisma generate
RUN npm run build

# Aplicar migraciones a la DB antes de iniciar
CMD ["sh", "-c", "npx prisma db push && npm start"]
