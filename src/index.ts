import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import { getOrCreateUser, updateUserOnboardingStep } from './services/userService';

dotenv.config();

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Generar código QR visible en el log de Railway
    if (qr) {
      console.log('--- ESCANEA ESTE CÓDIGO QR CON WHATSAPP ---');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as any)?.output?.statusCode !==
        DisconnectReason.loggedOut;
      console.log('Conexión cerrada. Reconectando...', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === 'open') {
      console.log('Conexión con WhatsApp establecida con éxito.');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        if (!msg.key.fromMe && msg.key.remoteJid) {
          const remoteJid = msg.key.remoteJid;
          const phone = remoteJid.split('@')[0];
          const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text;

          if (!text) continue;

          try {
            // 1. Obtener o crear el usuario con los nuevos campos de Prisma
            const user = await getOrCreateUser(phone);

            // 2. Manejo de mensajes según el onboardingStep
            if (user.onboardingStep === 'name') {
              await sock.sendMessage(remoteJid, {
                text: '¡Hola! Bienvenido/a a NutriBot. ¿Cuál es tu nombre?'
              });
              await updateUserOnboardingStep(phone, 'awaiting_name');
            } else if (user.onboardingStep === 'awaiting_name') {
              await updateUserOnboardingStep(phone, 'completed');
              await sock.sendMessage(remoteJid, {
                text: `¡Un gusto conocerte, ${text}! Tu perfil ha sido registrado.`
              });
            } else {
              console.log(`Mensaje de ${phone}: ${text}`);
            }
          } catch (error) {
            console.error('Error al procesar el mensaje:', error);
          }
        }
      }
    }
  });
}

startBot();
