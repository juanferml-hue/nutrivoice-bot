const { Client, LocalAuth } = require('whatsapp-web.js');
const { OpenAI } = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '/app/.wwebjs_auth'
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    }
});

// QR
client.on('qr', (qr) => {
    console.log('--- COPIA Y ABRE ESTE LINK EN TU CELULAR ---');
    console.log(
        'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' +
        encodeURIComponent(qr)
    );
});

// Autenticación
client.on('authenticated', () => {
    console.log('✅ WhatsApp autenticado correctamente');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación:', msg);
});

// Bot listo
client.on('ready', () => {
    console.log('✅ ¡BOT CONECTADO Y LISTO!');
});

// Desconexión
client.on('disconnected', (reason) => {
    console.log('⚠️ WhatsApp desconectado:', reason);
});

// Estado
client.on('change_state', (state) => {
    console.log('📱 Estado de WhatsApp:', state);
});

// Mensajes
client.on('message', async (msg) => {

    if (!msg.from.endsWith('@c.us')) {
        return;
    }

    try {

        console.log('📩 Mensaje recibido:', msg.body);

        const chat = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'user',
                    content: msg.body
                }
            ]
        });

        const respuesta =
            chat.choices[0]?.message?.content ||
            'No pude generar una respuesta';

        await msg.reply(respuesta);

        console.log('📤 Respuesta enviada');

    } catch (error) {

        console.error('❌ Error procesando mensaje:', error);

        await msg.reply(
            'Lo siento, tuve un problema procesando tu mensaje.'
        );
    }
});

client.initialize();
