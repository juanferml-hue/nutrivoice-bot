const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '/app/.wwebjs_auth'
    }),
    puppeteer: {
        protocolTimeout: 0,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote'
        ]
    }
});
client.on('loading_screen', (percent, message) => {
    console.log(`⏳ WhatsApp cargando: ${percent}% - ${message}`);
});

console.log('🚀 Iniciando WhatsApp Web...');

client.initialize().catch((error) => {
    console.error('❌ ERROR EN INITIALIZE:', error);
});
