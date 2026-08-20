const { Client, LocalAuth } = require('whatsapp-web.js');
import qrcode from 'qrcode-terminal';
import { analyzeMealText } from './services/aiService';

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/app/.wwebjs_auth' }),
    puppeteer: {
        executablePath: '/usr/bin/google-chrome-stable',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote'
        ]
    }
});

client.on('qr', (qr: string) => {
    console.log('--- ESCANEA ESTE QR O USA EL LINK ---');
    console.log('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ ¡NutriVoice Bot conectado y escuchando mensajes!');
});

// ESCUCHADOR DE MENSAJES INBOUND
client.on('message', async (msg: any) => {
    // Filtra para responder solo a chats privados
    if (msg.from.endsWith('@c.us')) {
        try {
            console.log(`📩 Mensaje recibido de ${msg.from}: ${msg.body}`);
            
            // Envía el texto a la IA para analizar
            const result = await analyzeMealText(msg.body);

            if (!result.is_food) {
                await msg.reply('Hola 👋, soy NutriVoice. Por favor envíame lo que comiste para calcular tus calorías.');
                return;
            }

            // Formatea la respuesta nutricional
            const responseText = `🥗 *Análisis Nutricional* (${result.meal_type.toUpperCase()})\n\n` +
                `🔥 *Calorías Totales:* ${result.total_calories} kcal\n` +
                `🥩 *Proteínas:* ${result.total_protein_g}g\n` +
                `🍞 *Carbohidratos:* ${result.total_carbs_g}g\n` +
                `🥑 *Grasas:* ${result.total_fats_g}g`;

            await msg.reply(responseText);

        } catch (error) {
            console.error('❌ Error procesando el mensaje:', error);
            await msg.reply('Lo siento, ocurrió un error al analizar tu mensaje.');
        }
    }
});

client.initialize().catch((error: any) => {
    console.error('❌ ERROR EN INITIALIZE:', error);
});
