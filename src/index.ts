const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '/app/.wwebjs_auth'
    }),
    puppeteer: {
        protocolTimeout: 120000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote'
        ]
    }
});
