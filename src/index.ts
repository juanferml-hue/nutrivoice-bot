import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import { getOrCreateUser, updateUserOnboardingStep } from './services/userService';
import { processUserMessage } from './services/aiService';
import { createPaymentPreference } from './services/paymentService';

dotenv.config();

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    browser: ['NutriBot', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Generar código QR compacto y URL directa en los logs de Railway
    if (qr) {
      console.log('\n==================================================');
      console.log('--- CÓDIGO QR COMPACTO ---');
      qrcode.generate(qr, { small: true });

      console.log('\n--- ENLACE PARA ESCANEAR EN NAVEGADOR ---');
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
      console.log(`Abre este enlace si el QR de la consola se ve distorsionado:\n${qrImageUrl}`);
      console.log('==================================================\n');
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
      console.log('✅ Conexión con WhatsApp establecida con éxito.');
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
            // 1. Obtener o crear usuario en la base de datos de Prisma
            const user = await getOrCreateUser(phone);

            // 2. Control de Onboarding
            if (user.onboardingStep !== 'completed') {
              if (user.onboardingStep === 'name') {
                await sock.sendMessage(remoteJid, {
                  text: '¡Hola! Bienvenido/a a NutriBot. ¿Cuál es tu nombre?'
                });
                await updateUserOnboardingStep(phone, 'awaiting_name');
              } else if (user.onboardingStep === 'awaiting_name') {
                await updateUserOnboardingStep(phone, 'completed');
                await sock.sendMessage(remoteJid, {
                  text: `¡Un gusto conocerte, ${text}! Tu registro se completó. ¿En qué puedo ayudarte hoy con tu nutrición?`
                });
              }
              continue;
            }

            // 3. Respuesta con Inteligencia Artificial (OpenAI)
            const aiResponse = await processUserMessage(user.id, text);
            await sock.sendMessage(remoteJid, { text: aiResponse });

          } catch (error) {
            console.error('Error al procesar el mensaje:', error);
            await sock.sendMessage(remoteJid, {
              text: 'Ocurrió un error al procesar tu solicitud. Por favor intenta de nuevo.'
            });
          }
        }
      }
    }
  });
}

startBot();
