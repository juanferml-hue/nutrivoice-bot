import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import { 
  transcribeAudio, 
  analyzeMealText, 
  generateUserResponse, 
  analyzeMealImage,
  suggestRecipe,
  generateShoppingList,
  generateWeeklyProgress
} from './services/aiService';
import { createPaymentLink } from './services/paymentService';

const prisma = new PrismaClient();

// Límite de mensajes/registros en la versión gratuita
const FREE_TRIAL_LIMIT = 5;

// 👥 LISTA BLANCA DE USUARIOS BETA / FAMILIARES (Acceso ilimitado GRATIS)
const BETA_TESTERS = [
  '573007924700@s.whatsapp.net',
  '573007874110@s.whatsapp.net',
  '4915202158344@s.whatsapp.net',
  '15875733105@s.whatsapp.net',
  '573136190575@s.whatsapp.net'
];

// Función auxilar para calcular macros restantes del día
async function calculateRemainingMacros(userId: string, targetCalories: number, targetProtein: number, targetCarbs: number, targetFats: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todaysMeals = await prisma.meal.findMany({
    where: {
      userId: userId,
      createdAt: { gte: today }
    }
  });

  const totalConsumed = todaysMeals.reduce((acc, m) => ({
    calories: acc.calories + m.calories,
    protein: acc.protein + m.protein,
    carbs: acc.carbs + m.carbs,
    fats: acc.fats + m.fats
  }), { calories: 0, protein: 0, carbs: 0, fats: 0 });

  return {
    calories: (targetCalories || 2000) - totalConsumed.calories,
    protein: (targetProtein || 120) - totalConsumed.protein,
    carbs: (targetCarbs || 220) - totalConsumed.carbs,
    fats: (targetFats || 60) - totalConsumed.fats
  };
}

// Manejador del flujo de Onboarding (Registro inicial de datos)
async function handleOnboarding(sock: any, sender: string, user: any, text: string) {
  const input = text.trim();

  if (!user.name) {
    await prisma.user.update({ where: { phone: sender }, data: { name: input } });
    await sock.sendMessage(sender, { text: `¡Gusto en conocerte, ${input}! 👋\n\n¿Cuál es tu edad? (Ejemplo: 25)` });
    return;
  }

  if (!user.age) {
    const age = parseInt(input);
    if (isNaN(age)) {
      await sock.sendMessage(sender, { text: 'Por favor, ingresa un número válido para tu edad. 🔢' });
      return;
    }
    await prisma.user.update({ where: { phone: sender }, data: { age } });
    await sock.sendMessage(sender, { text: 'Genial. ¿Cuánto pesas actualmente en kg? (Ejemplo: 70.5)' });
    return;
  }

  if (!user.weight) {
    const weight = parseFloat(input.replace(',', '.'));
    if (isNaN(weight)) {
      await sock.sendMessage(sender, { text: 'Por favor, ingresa un número válido para tu peso. ⚖️' });
      return;
    }
    await prisma.user.update({ where: { phone: sender }, data: { weight } });
    await sock.sendMessage(sender, { text: 'Perfecto. ¿Cuál es tu estatura en cm? (Ejemplo: 175)' });
    return;
  }

  if (!user.height) {
    const height = parseFloat(input.replace(',', '.'));
    if (isNaN(height)) {
      await sock.sendMessage(sender, { text: 'Por favor, ingresa un número válido para tu estatura. 📏' });
      return;
    }
    await prisma.user.update({ where: { phone: sender }, data: { height } });
    await sock.sendMessage(sender, { text: '¿Cuál es tu nivel de actividad física diaria?\n\n1️⃣ Sedentario\n2️⃣ Moderado\n3️⃣ Muy activo\n\nResponde con el número de tu opción.' });
    return;
  }

  if (!user.activityLevel) {
    let activity = 'sedentario';
    if (input === '2') activity = 'moderado';
    if (input === '3') activity = 'muy activo';

    await prisma.user.update({ where: { phone: sender }, data: { activityLevel: activity } });
    await sock.sendMessage(sender, { text: '¿Cuál es tu objetivo principal?\n\n1️⃣ Perder peso\n2️⃣ Mantener peso\n3️⃣ Ganar masa muscular\n\nResponde con el número de tu opción.' });
    return;
  }

  if (!user.goal) {
    let goal = 'mantener';
    if (input === '1') goal = 'perder_peso';
    if (input === '3') goal = 'ganar_músculo';

    let targetCalories = 2000;
    if (goal === 'perder_peso') targetCalories = 1700;
    if (goal === 'ganar_músculo') targetCalories = 2400;

    const targetProtein = Math.round((targetCalories * 0.25) / 4);
    const targetCarbs = Math.round((targetCalories * 0.45) / 4);
    const targetFats = Math.round((targetCalories * 0.30) / 9);

    await prisma.user.update({
      where: { phone: sender },
      data: {
        goal,
        targetCalories,
        targetProtein,
        targetCarbs,
        targetFats
      }
    });

    const isBetaUser = BETA_TESTERS.includes(sender);
    const welcomeTrialText = isBetaUser 
      ? '👑 *¡Tienes un Pase VIP Beta con accesos ILIMITADOS!*' 
      : `Tienes ${FREE_TRIAL_LIMIT} registros de prueba gratuita.`;

    await sock.sendMessage(sender, {
      text: `🎉 ¡Perfil configurado con éxito!\n\nTu meta diaria calculada es:\n🔥 Calorías: ${targetCalories} kcal\n🥩 Proteínas: ${targetProtein} g\n🍞 Carbohidratos: ${targetCarbs} g\n🥑 Grasas: ${targetFats} g\n\n${welcomeTrialText}\n\n💡 *Comandos útiles:* Escribe *receta*, *compras* o *avance* en cualquier momento.`
    });
  }
}

// Configuración de Trabajos Programados (Cron Jobs)
function setupCronJobs(sock: any) {
  // 1. Recordatorios diarios a las 20:00 (8:00 PM)
  cron.schedule('0 20 * * *', async () => {
    try {
      const users = await prisma.user.findMany();
      for (const user of users) {
        await sock.sendMessage(user.phone, {
          text: `👋 ¡Hola! Recuerda registrar tus alimentos de hoy en NutriVoice para no perder la secuencia de tus metas. 🥗📸`
        });
      }
    } catch (error) {
      console.error('Error enviando recordatorios programados:', error);
    }
  });

  // 2. Reporte Semanal Automático los Domingos a las 09:00 AM
  cron.schedule('0 9 * * 0', async () => {
    try {
      const users = await prisma.user.findMany({ where: { goal: { not: null } } });
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      for (const user of users) {
        const weeklyMeals = await prisma.meal.findMany({
          where: {
            userId: user.id,
            createdAt: { gte: sevenDaysAgo }
          }
        });

        if (weeklyMeals.length > 0) {
          const report = await generateWeeklyProgress(
            user.name || 'Usuario',
            user.goal || 'mantener',
            user.targetCalories || 2000,
            weeklyMeals
          );

          await sock.sendMessage(user.phone, {
            text: `📊 *¡Tu Reporte Semanal de NutriVoice está listo!* ☀️\n\n${report}`
          });
        }
      }
    } catch (error) {
      console.error('Error enviando reportes semanales automáticos:', error);
    }
  });
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('.wwebjs_auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexión cerrada. Reconectando...', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('✅ ¡NutriVoice Bot CONECTADO Y ESCUCHANDO!');
      setupCronJobs(sock);
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    if (!sender || !sender.endsWith('@s.whatsapp.net')) return;

    try {
      const isBetaUser = BETA_TESTERS.includes(sender);

      // 1. Obtener o crear usuario en Base de Datos
      let user = await prisma.user.findUnique({ where: { phone: sender } });
      if (!user) {
        user = await prisma.user.create({
          data: { 
            phone: sender,
            isPro: isBetaUser 
          }
        });
        await sock.sendMessage(sender, {
          text: '👋 ¡Bienvenido a **NutriVoice**! Tu asistente nutricional con IA.\n\nPara personalizar tus metas, respondamos unas breves preguntas.\n\n¿Cuál es tu nombre?'
        });
        return;
      }

      if (isBetaUser && !user.isPro) {
        user = await prisma.user.update({
          where: { phone: sender },
          data: { isPro: true }
        });
      }

      // 2. Comprobar si está en Onboarding
      if (!user.goal) {
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (textMessage) {
          await handleOnboarding(sock, sender, user, textMessage);
        } else {
          await sock.sendMessage(sender, { text: 'Por favor, responde con un texto para continuar la configuración de tu perfil.' });
        }
        return;
      }

      const textMessage = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim().toLowerCase();

      // -------------------------------------------------------------
      // NUEVOS COMANDOS SPRINT RETENCIÓN
      // -------------------------------------------------------------

      // COMANDO A: RECOMENDACIÓN DE RECETA
      if (['receta', 'recetas', 'que como', 'qué como', 'sugerencia'].includes(textMessage)) {
        await sock.sendMessage(sender, { text: '🍳 Pensando en una receta ideal para tus metas de hoy...' });
        const remaining = await calculateRemainingMacros(
          user.id,
          user.targetCalories || 2000,
          user.targetProtein || 120,
          user.targetCarbs || 220,
          user.targetFats || 60
        );

        const recipeSuggestion = await suggestRecipe(remaining, user.goal || 'mantener');
        await sock.sendMessage(sender, { text: `👨‍🍳 *Sugerencia NutriVoice:*\n\n${recipeSuggestion}` });
        return;
      }

      // COMANDO B: LISTA DE COMPRAS SEMANAL
      if (['compras', 'lista de compras', 'mercado', 'lista'].includes(textMessage)) {
        await sock.sendMessage(sender, { text: '🛒 Preparando tu lista de mercado personalizada...' });
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const weeklyMeals = await prisma.meal.findMany({
          where: { userId: user.id, createdAt: { gte: sevenDaysAgo } }
        });

        const shoppingList = await generateShoppingList(weeklyMeals, user.goal || 'mantener');
        await sock.sendMessage(sender, { text: `📝 *Tu Lista de Mercado Recomendada:*\n\n${shoppingList}` });
        return;
      }

      // COMANDO C: REPORTE DE AVANCE MANUAL
      if (['avance', 'resumen', 'mi avance', 'reporte'].includes(textMessage)) {
        await sock.sendMessage(sender, { text: '📊 Calculando tu progreso de los últimos 7 días...' });
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const weeklyMeals = await prisma.meal.findMany({
          where: { userId: user.id, createdAt: { gte: sevenDaysAgo } }
        });

        if (weeklyMeals.length === 0) {
          await sock.sendMessage(sender, { text: 'Aún no tienes registros en los últimos 7 días. Empieza a enviarme tus fotos o audios de comida para generar tu avance. 🥗' });
          return;
        }

        const progressReport = await generateWeeklyProgress(
          user.name || 'Usuario',
          user.goal || 'mantener',
          user.targetCalories || 2000,
          weeklyMeals
        );

        await sock.sendMessage(sender, { text: `📈 *Tu Análisis de Avance:* \n\n${progressReport}` });
        return;
      }

      // Detectar comando explícito para solicitar link de suscripción
      if (['suscribirme', 'pagar', 'plan', 'comprar', 'suscribir'].includes(textMessage)) {
        if (user.isPro) {
          await sock.sendMessage(sender, { text: '🌟 ¡Ya cuentas con una suscripción PRO activa e ilimitada!' });
          return;
        }
        const paymentLink = await createPaymentLink(sender);
        await sock.sendMessage(sender, {
          text: `🚀 *¡Pasa a NutriVoice PRO y obtén registros ilimitados!*\n\nHaz clic en el siguiente enlace para activar tu suscripción con Mercado Pago:\n👉 ${paymentLink}`
        });
        return;
      }

      // 3. Verificación de prueba gratuita
      if (!user.isPro && user.messagesUsed >= FREE_TRIAL_LIMIT) {
        const paymentLink = await createPaymentLink(sender);
        await sock.sendMessage(sender, {
          text: `⚠️ *Has alcanzado el límite de tu prueba gratuita (${FREE_TRIAL_LIMIT} registros).* \n\nPara seguir registrando alimentos y desbloquear recetas y lista de compras, suscríbete a **NutriVoice PRO**.\n\n👉 *Activa tu cuenta aquí:* ${paymentLink}`
        });
        return;
      }

      // 4. Procesar Registro de Comida
      let transcription = '';
      let mealData: any = null;

      if (msg.message.audioMessage) {
        await sock.sendMessage(sender, { text: '🎧 Escuchando tu nota de voz...' });
        const audioBuffer = await downloadMediaMessage(msg, 'buffer', {});
        transcription = await transcribeAudio(audioBuffer as Buffer);
        mealData = await analyzeMealText(transcription);
      }
      else if (msg.message.imageMessage) {
        await sock.sendMessage(sender, { text: '📸 Analizando la imagen de tu comida...' });
        const imageBuffer = await downloadMediaMessage(msg, 'buffer', {});
        const base64Image = (imageBuffer as Buffer).toString('base64');
        const mimeType = msg.message.imageMessage.mimetype || 'image/jpeg';
        
        mealData = await analyzeMealImage(base64Image, mimeType);
        transcription = msg.message.imageMessage.caption || 'Foto de comida enviada';
      }
      else if (msg.message.conversation || msg.message.extendedTextMessage) {
        transcription = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        mealData = await analyzeMealText(transcription);
      } else {
        return;
      }

      if (!mealData || mealData.is_food === false) {
        await sock.sendMessage(sender, {
          text: '🤔 No logré identificar ningún alimento en tu mensaje. Intenta enviarme una foto de tu plato o descríbeme qué comiste (Ej: "Un huevo cocido con 1 rebanada de pan").'
        });
        return;
      }

      // 5. Guardar la Comida en la BD
      await prisma.meal.create({
        data: {
          userId: user.id,
          type: mealData.meal_type || 'snack',
          description: transcription,
          calories: mealData.total_calories || 0,
          protein: mealData.total_protein_g || 0,
          carbs: mealData.total_carbs_g || 0,
          fats: mealData.total_fats_g || 0
        }
      });

      // 6. Incrementar uso
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { messagesUsed: { increment: 1 } }
      });

      // 7. Saldo restante del día
      const remainingMacros = await calculateRemainingMacros(
        user.id,
        user.targetCalories || 2000,
        user.targetProtein || 120,
        user.targetCarbs || 220,
        user.targetFats || 60
      );

      // 8. Responder al usuario
      const responseMessage = await generateUserResponse(transcription, mealData, remainingMacros);
      
      let extraNote = '';
      if (!updatedUser.isPro) {
        const remainingTrials = FREE_TRIAL_LIMIT - updatedUser.messagesUsed;
        if (remainingTrials > 0) {
          extraNote = `\n\n💡 _Te quedan ${remainingTrials} registros de prueba gratuita._`;
        }
      }

      await sock.sendMessage(sender, { text: `${responseMessage}${extraNote}` });

    } catch (error) {
      console.error('❌ Error procesando el mensaje:', error);
      await sock.sendMessage(sender, { text: 'Ocurrió un error al procesar tu solicitud. Por favor intenta de nuevo.' });
    }
  });
}

connectToWhatsApp();
