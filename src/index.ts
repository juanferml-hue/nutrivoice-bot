import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { analyzeMealText } from './services/aiService';

const WWEBJS_AUTH_PATH = '/app/.wwebjs_auth';

// Track whether the client has successfully reached the 'ready' state.
// Used by the startup heartbeat to detect a stuck initialization.
let isClientReady = false;
let qrReceivedAt: number | null = null;

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------
// The aiService depends on OPENAI_API_KEY. If it's missing, message handling
// will fail at runtime, but more importantly we want this surfaced loudly at
// startup so it's not confused with a whatsapp-web.js/Puppeteer issue.
function validateEnvironment(): void {
    if (!process.env.OPENAI_API_KEY) {
        console.error('❌ ERROR CRÍTICO: La variable de entorno OPENAI_API_KEY no está definida.');
        console.error('   El bot puede iniciar y mostrar el QR, pero analyzeMealText() fallará en cada mensaje.');
        console.error('   Configura OPENAI_API_KEY en las variables de entorno del servicio.');
    } else {
        console.log('✅ OPENAI_API_KEY detectada correctamente.');
    }
}

validateEnvironment();

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

console.log('🛠️ Construyendo instancia de whatsapp-web.js Client...');

let client: Client;

try {
    client = new Client({
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
    console.log('✅ Instancia de Client creada correctamente.');
} catch (error: any) {
    console.error('❌ ERROR CRÍTICO al construir el Client de whatsapp-web.js:', error?.message || error);
    console.error(error?.stack || '');
    process.exit(1);
}

try {
    client.on('qr', (qr: string) => {
        qrReceivedAt = Date.now();
        console.log('📱 Evento "qr" recibido. Esperando escaneo del código QR...');
        console.log('--- COPIA Y ABRE ESTE LINK EN TU NAVEGADOR ---');
        console.log('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
        qrcode.generate(qr, { small: true });
    });

    client.on('loading_screen', (percent: number, message: string) => {
        console.log(`⏳ Cargando WhatsApp Web: ${percent}% - ${message}`);
    });

    client.on('authenticated', () => {
        console.log('🔐 Evento "authenticated" recibido. Sesión autenticada correctamente.');
    });

    client.on('auth_failure', (msg: string) => {
        console.error('❌ Evento "auth_failure": falló la autenticación de WhatsApp:', msg);
    });

    client.on('ready', () => {
        isClientReady = true;
        console.log('🚀 Evento "ready" recibido.');
        console.log('✅ ¡NutriVoice Bot conectado y escuchando mensajes!');
    });

    client.on('disconnected', (reason: string) => {
        isClientReady = false;
        console.error('⚠️ Evento "disconnected": el cliente de WhatsApp se desconectó. Razón:', reason);
    });

    client.on('change_state', (state: string) => {
        console.log(`🔄 Cambio de estado del cliente: ${state}`);
    });

    client.on('error', (error: any) => {
        console.error('❌ Evento "error" del cliente de WhatsApp:', error?.message || error);
        console.error(error?.stack || '');
    });
} catch (error: any) {
    console.error('❌ ERROR CRÍTICO al registrar los listeners de eventos:', error?.message || error);
    console.error(error?.stack || '');
    process.exit(1);
}

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

// ---------------------------------------------------------------------------
// Heartbeat: detect if the bot gets stuck between QR scan and 'ready'.
// ---------------------------------------------------------------------------
const STARTUP_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const HEARTBEAT_INTERVAL_MS = 15 * 1000; // 15 seconds

const startedAt = Date.now();

const heartbeat = setInterval(() => {
    if (isClientReady) {
        clearInterval(heartbeat);
        return;
    }

    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`💓 Heartbeat: el bot aún no está "ready" (${elapsedSeconds}s desde el arranque). QR recibido: ${qrReceivedAt ? 'sí' : 'no'}.`);

    if (Date.now() - startedAt > STARTUP_TIMEOUT_MS) {
        console.error(`⏰ TIMEOUT: han pasado más de ${STARTUP_TIMEOUT_MS / 1000}s y el cliente sigue sin estar "ready".`);
        if (!qrReceivedAt) {
            console.error('   Nunca se recibió el evento "qr". Puppeteer/Chrome podría estar fallando al arrancar.');
        } else {
            console.error('   El QR se generó pero el cliente nunca terminó de autenticarse/inicializarse. Revisa "authenticated"/"auth_failure" arriba.');
        }
    }
}, HEARTBEAT_INTERVAL_MS);

(async () => {
    try {
        console.log('▶️ Llamando a client.initialize()...');
        await client.initialize();
        console.log('✅ client.initialize() se resolvió correctamente (esto no implica "ready" todavía).');
    } catch (error: any) {
        console.error('❌ ERROR EN INITIALIZE (excepción capturada):', error?.message || error);
        console.error(error?.stack || '');
        clearInterval(heartbeat);
    }
})();

process.on('unhandledRejection', (reason: any) => {
    console.error('❌ UNHANDLED REJECTION detectada:', reason?.message || reason);
    console.error(reason?.stack || '');
});

process.on('uncaughtException', (error: any) => {
    console.error('❌ UNCAUGHT EXCEPTION detectada:', error?.message || error);
    console.error(error?.stack || '');
});
