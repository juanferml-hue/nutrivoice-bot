import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { analyzeMealText } from './services/aiService';

const WWEBJS_AUTH_PATH = '/app/.wwebjs_auth';

// Completely wipe the WhatsApp auth/profile directory on every startup.
// Previously we only removed the .SingletonLock file, but that was not
// enough: the rest of the Chrome profile could still be left in a corrupted
// state (e.g. re-mounted or cached volumes), causing Chrome to refuse to
// start. Forcefully deleting and recreating the whole directory guarantees
// a clean profile for every deploy, at the cost of requiring a fresh QR
// code scan each time.
function cleanWhatsAppAuthDirectory(): void {
    try {
        if (fs.existsSync(WWEBJS_AUTH_PATH)) {
            fs.rmSync(WWEBJS_AUTH_PATH, { recursive: true, force: true });
            console.log('🧹 Se eliminó por completo el directorio de sesión de WhatsApp.');
        }
        fs.mkdirSync(WWEBJS_AUTH_PATH, { recursive: true });
        console.log('📁 Se creó un directorio de sesión de WhatsApp limpio.');
    } catch (error: any) {
        console.error('⚠️ No se pudo limpiar el directorio de sesión de WhatsApp:', error?.message || error);
    }
}

cleanWhatsAppAuthDirectory();

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: WWEBJS_AUTH_PATH }),
    puppeteer: {
        executablePath: '/usr/bin/google-chrome-stable',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-default-apps',
            '--disable-preconnect',
            '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ]
    }
});

client.on('qr', (qr: string) => {
    console.log('--- COPIA Y ABRE ESTE LINK EN TU NAVEGADOR ---');
    console.log('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ ¡NutriVoice Bot conectado y escuchando mensajes!');
});

client.on('message_create', async (msg: any) => {
    if (msg.fromMe) return;

    console.log(`📩 Mensaje recibido desde ${msg.from}: ${msg.body}`);

    try {
        const result = await analyzeMealText(msg.body);

        if (!result.is_food) {
            await msg.reply('Hola 👋, soy NutriVoice. Envíame lo que comiste para calcular tus calorías y macronutrientes.');
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
        await msg.reply('Ocurrió un error al analizar la información.');
    }
});

client.initialize().catch((error: any) => {
    console.error('❌ ERROR EN INITIALIZE:', error);
});
