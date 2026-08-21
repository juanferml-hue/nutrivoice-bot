import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import http from 'http';
import { analyzeMealText } from './services/aiService';

// 1. SERVIDOR DUMMY PARA EVITAR QUE RAILWAY MATE EL PROCESO (HEALTHCHECK)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('NutriVoice Bot está activo 🚀\n');
}).listen(PORT, () => {
    console.log(`🌐 Servidor de Healthcheck escuchando en el puerto ${PORT}`);
});

// 2. INICIALIZACIÓN DEL CLIENTE DE WHATSAPP
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/app/.wwebjs_auth' }),
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
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr: string) => {
    console.log('--- COPIA Y ABRE ESTE LINK EN TU NAVEGADOR ---');
    console.log('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ ¡NutriVoice Bot conectado y escuchando mensajes correctamente!');
});

// Manejador centralizado de mensajes
const handleMessage = async (msg: any) => {
    if (msg.fromMe) return;

    console.log(`📩 Mensaje recibido de ${msg.from}: ${msg.body}`);

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
        console.error('❌ Error en el procesamiento:', error?.message || error);
        await msg.reply('Ocurrió un error al procesar el mensaje.');
    }
};

client.on('message', handleMessage);
client.on('message_create', handleMessage);

client.initialize().catch((error: any) => {
    console.error('❌ ERROR EN INITIALIZE:', error);
});
