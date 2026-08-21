import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import http from 'http';
import { analyzeMealText } from './services/aiService';

// 1. Servidor de Healthcheck para Railway
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('NutriVoice Bot está activo 🚀\n');
}).listen(PORT, () => {
    console.log(`🌐 Servidor de Healthcheck escuchando en puerto ${PORT}`);
});

// 2. Cliente de WhatsApp con banderas de baja memoria y bypass de Puppeteer
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'nutrivoice-v4' }),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Fuerza a Chromium a correr en un solo proceso
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr: string) => {
    console.log('--- ESCANEA ESTE CÓDIGO QR ---');
    console.log('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('🔑 Autenticación exitosa en WhatsApp Web. Esperando inicialización del cliente...');
});

client.on('ready', () => {
    console.log('✅ ¡NutriVoice Bot CONECTADO y ESCUCHANDO!');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación:', msg);
});

// Escuchador de mensajes
const handleMessage = async (msg: any) => {
    console.log(`📩 Mensaje detectado | De: ${msg.from} | Texto: ${msg.body}`);

    if (msg.fromMe) return;

    try {
        const result = await analyzeMealText(msg.body);

        if (!result.is_food) {
            await msg.reply('Hola 👋, soy NutriVoice. Envíame lo que comiste para calcular tus calorías.');
            return;
        }

        const responseText = `🥗 *Análisis Nutricional* (${(result.meal_type || 'comida').toUpperCase()})\n\n` +
            `🔥 *Calorías Totales:* ${result.total_calories || 0} kcal\n` +
            `🥩 *Proteínas:* ${result.total_protein_g || 0}g\n` +
            `🍞 *Carbohidratos:* ${result.total_carbs_g || 0}g\n` +
            `🥑 *Grasas:* ${result.total_fats_g || 0}g`;

        await msg.reply(responseText);
        console.log('✅ Respuesta enviada exitosamente.');

    } catch (error: any) {
        console.error('❌ Error en el procesamiento:', error?.message || error);
    }
};

client.on('message', handleMessage);
client.on('message_create', handleMessage);

client.initialize().catch((error: any) => {
    console.error('❌ Error inicializando el cliente:', error);
});
