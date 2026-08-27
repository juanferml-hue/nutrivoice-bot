import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import { getOrCreateUser, updateUserOnboardingStep } from './services/userService';
import {
  analyzeMealText,
  generateUserResponse,
  suggestRecipe,
  generateShoppingList,
  generateWeeklyProgress,
  transcribeAudio,
  analyzeMealImage
} from './services/aiService';
import { createPaymentLink } from './services/paymentService';

dotenv.config();

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    browser: ['NutriBot', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n==================================================');
      console.log('--- CÓDIGO QR COMPACTO ---');
      qrcode.generate(qr, { small: true });

      console.log('\n--- ENLACE PARA ESCANEAR EN NAVEGADOR ---');
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
      console.log(`Abre este enlace en tu navegador para ver el QR limpio:\n${qrImageUrl}`);
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

          try {
            const user = await getOrCreateUser(phone);

            // 1. ONBOARDING DETALLADO (Nombre -> Edad -> Sexo -> Peso -> Estatura -> Objetivo)
            if (user.onboardingStep !== 'completed') {
              const text = (
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                ''
              ).trim();

              if (user.onboardingStep === 'name') {
                await sock.sendMessage(remoteJid, {
                  text: '¡Hola! Bienvenido/a a NutriVoice. ¿Cuál es tu nombre?'
                });
                await updateUserOnboardingStep(phone, 'awaiting_name');
              } else if (user.onboardingStep === 'awaiting_name' && text) {
                await updateUserOnboardingStep(phone, 'awaiting_age');
                await sock.sendMessage(remoteJid, {
                  text: `¡Un gusto, ${text}! ¿Cuál es tu edad?`
                });
              } else if (user.onboardingStep === 'awaiting_age' && text) {
                await updateUserOnboardingStep(phone, 'awaiting_gender');
                await sock.sendMessage(remoteJid, {
                  text: '¿Cuál es tu sexo biológico? (Hombre / Mujer)'
                });
              } else if (user.onboardingStep === 'awaiting_gender' && text) {
                await updateUserOnboardingStep(phone, 'awaiting_weight');
                await sock.sendMessage(remoteJid, {
                  text: '¿Cuál es tu peso actual en kg? (Ejemplo: 70)'
                });
              } else if (user.onboardingStep === 'awaiting_weight' && text) {
                await updateUserOnboardingStep(phone, 'awaiting_height');
                await sock.sendMessage(remoteJid, {
                  text: '¿Cuál es tu estatura en cm? (Ejemplo: 175)'
                });
              } else if (user.onboardingStep === 'awaiting_height' && text) {
                await updateUserOnboardingStep(phone, 'awaiting_goal');
                await sock.sendMessage(remoteJid, {
                  text: '¿Cuál es tu objetivo principal?\n\n1. Bajar de peso\n2. Mantener peso\n3. Ganar masa muscular'
                });
              } else if (user.onboardingStep === 'awaiting_goal' && text) {
                await updateUserOnboardingStep(phone, 'completed');
                await sock.sendMessage(remoteJid, {
                  text: '¡Perfil configurado con éxito! 🎉\n\nDesde ahora puedes enviarme notas de voz, fotos de tus comidas o texto.\n\nComandos rápidos disponibles:\n• "Receta" para sugerencias personalizadas\n• "Lista de compras" para tu mercado\n• "Pago" para activar la versión PRO'
                });
              }
              continue;
            }

            // 2. Procesamiento de Notas de Voz
            if (msg.message?.audioMessage) {
              const buffer = (await downloadMediaMessage(
                msg,
                'buffer',
                {}
              )) as Buffer;
              const transcription = await transcribeAudio(buffer);
              const mealData = await analyzeMealText(transcription);

              const dummyRemaining = { calories: 1500, protein: 100, carbs: 150, fats: 50 };
              const response = await generateUserResponse(transcription, mealData, dummyRemaining);

              await sock.sendMessage(remoteJid, { text: response || 'Registro procesado con éxito.' });
              continue;
            }

            // 3. Procesamiento de Imágenes de Comida
            if (msg.message?.imageMessage) {
              const buffer = (await downloadMediaMessage(
                msg,
                'buffer',
                {}
              )) as Buffer;
              const base64Image = buffer.toString('base64');
              const mealData = await analyzeMealImage(base64Image, 'image/jpeg');

              const dummyRemaining = { calories: 1500, protein: 100, carbs: 150, fats: 50 };
              const response = await generateUserResponse('Imagen de plato de comida', mealData, dummyRemaining);

              await sock.sendMessage(remoteJid, { text: response || 'Imagen analizada con éxito.' });
              continue;
            }

            // 4. Procesamiento de Mensajes de Texto y Comandos
            const text =
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text;

            if (text) {
              const textLower = text.toLowerCase();

              // Comando: Recetas
              if (textLower.includes('receta') || textLower.includes('sugerir')) {
                const dummyRemaining = { calories: 500, protein: 40, carbs: 50, fats: 15 };
                const recipeSuggestion = await suggestRecipe(dummyRemaining, user.goal || 'Mantener peso');
                await sock.sendMessage(remoteJid, { text: recipeSuggestion || '' });
                continue;
              }

              // Comando: Lista de compras
              if (textLower.includes('compras') || textLower.includes('mercado') || textLower.includes('lista')) {
                const shoppingList = await generateShoppingList([], user.goal || 'Mantener peso');
                await sock.sendMessage(remoteJid, { text: shoppingList || '' });
                continue;
              }

              // Comando: Avance semanal
              if (textLower.includes('avance') || textLower.includes('informe') || textLower.includes('progreso')) {
                const progressReport = await generateWeeklyProgress('Usuario', user.goal || 'Mantener peso', 2000, []);
                await sock.sendMessage(remoteJid, { text: progressReport || '' });
                continue;
              }

              // Comando: Enlace de Pago
              if (textLower.includes('pago') || textLower.includes('suscripcion') || textLower.includes('pro')) {
                const paymentUrl = await createPaymentLink(phone);
                await sock.sendMessage(remoteJid, {
                  text: `Para activar tu cuenta PRO y acceder a todas las funciones, haz clic en este enlace de pago:\n${paymentUrl}`
                });
                continue;
              }

              // Registro normal de comida por texto
              const mealData = await analyzeMealText(text);
              const dummyRemaining = { calories: 1500, protein: 100, carbs: 150, fats: 50 };
              const response = await generateUserResponse(text, mealData, dummyRemaining);

              await sock.sendMessage(remoteJid, { text: response || 'Procesado con éxito.' });
            }
          } catch (error) {
            console.error('Error al procesar el mensaje:', error);
            await sock.sendMessage(remoteJid, {
              text: 'Ocurrió un error al procesar tu mensaje. Por favor intenta de nuevo.'
            });
          }
        }
      }
    }
  });
}

startBot();
