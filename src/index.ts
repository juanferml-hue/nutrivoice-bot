import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import http from 'http';
import { analyzeMealText } from './services/aiService';

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('NutriVoice Bot activo 🚀\n');
}).listen(PORT, () => console.log(`🌐 Healthcheck en puerto ${PORT}`));

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('/app/.wwebjs_auth');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('--- ESCANEA ESTE CÓDIGO QR ---');
            console.log('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ Conexión cerrada. Reconectando:', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ ¡NutriVoice Bot CONECTADO Y ESCUCHANDO!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!text || !remoteJid) return;

        console.log(`📩 Mensaje recibido de ${remoteJid}: ${text}`);

        try {
            const result = await analyzeMealText(text);

            if (!result.is_food) {
                await sock.sendMessage(remoteJid, { text: 'Hola 👋, soy NutriVoice. Envíame lo que comiste para calcular tus calorías.' });
                return;
            }

            const responseText = `🥗 *Análisis Nutricional* (${(result.meal_type || 'comida').toUpperCase()})\n\n` +
                `🔥 *Calorías Totales:* ${result.total_calories || 0} kcal\n` +
                `🥩 *Proteínas:* ${result.total_protein_g || 0}g\n` +
                `🍞 *Carbohidratos:* ${result.total_carbs_g || 0}g\n` +
                `🥑 *Grasas:* ${result.total_fats_g || 0}g`;

            await sock.sendMessage(remoteJid, { text: responseText });
            console.log('✅ Respuesta enviada con éxito.');
        } catch (error: any) {
            console.error('❌ Error procesando el mensaje:', error?.message || error);
        }
    });
}

connectToWhatsApp();
