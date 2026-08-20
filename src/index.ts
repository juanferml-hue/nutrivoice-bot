const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox'] }
});

client.on('qr', (qr: string) => {
    console.log('--- ESCANEA ESTE QR DESDE TU CELULAR ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('¡Bot conectado y listo!');
});

client.on('message', async (msg: any) => {
    if (msg.from.endsWith('@c.us')) {
        const chat = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: msg.body }]
        });
        msg.reply(chat.choices[0].message.content || 'No pude generar respuesta');
    }
});

client.initialize();
