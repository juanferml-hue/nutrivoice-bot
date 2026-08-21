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
    console.log(`🌐 Servidor de Healthcheck en puerto ${PORT}`);
});

// 2. Cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'nutrivoice-session-v3' }),
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
            '--disable-gpu',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        ]
    }
});

client.on('qr', (qr: string) => {
    console.log('--- ESCANEA ESTE NUEVO CÓDIGO QR ---');
    console.log('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('🔑 Autenticación exitosa en WhatsApp Web.');
});

client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Cargando WhatsApp Web: ${percent}% - ${message}`);
});

client.on('ready', () => {
    console.log('✅ ¡NutriVoice Bot CONECTADO y ESCUCHANDO!');
});

// Manejador de mensajes
const handleMessage = async (msg: any) => {
    console.log(`📩 Mensaje recibido de ${msg.from}: ${msg.body}`);

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
        console.log('✅ Respuesta enviada con éxito.');

    } catch (error: any) {
        console.error('❌ Error procesando el mensaje:', error?.message || error);
    }
};

client.on('message', handleMessage);

client.initialize().catch((error: any) => {
    console.error('❌ ERROR EN INITIALIZE:', error);
});
