import crypto from 'crypto';
if (!globalThis.crypto) {
    (globalThis as any).crypto = crypto;
}

import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import http from 'http';
import cron from 'node-cron';
import { analyzeMealText, generateUserResponse, analyzeMealImage, transcribeAudio } from './services/aiService';
import { prisma, getOrCreateUser, calculateMacros } from './services/userService';

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('NutriVoice Bot activo 🚀\n');
}).listen(PORT, () => console.log(`🌐 Healthcheck en puerto ${PORT}`));

async function main() {
    try {
        console.log('🔄 Sincronizando esquema de base de datos...');
        await prisma.$executeRawUnsafe(`SELECT 1`);
    } catch (e) {
        console.log('Esperando conexión con DB...');
    }
}
main();

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
            
            // Iniciar el programador de recordatorios
            setupReminderCron(sock);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) return;

        const isImage = !!msg.message.imageMessage;
        const isAudio = !!msg.message.audioMessage;
        let text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

        if (!text && !isImage && !isAudio) return;

        try {
            const user = await getOrCreateUser(remoteJid);

            // FLUJO DE ONBOARDING / EDICIÓN DE PERFIL
            if (user.onboardingStep !== 'COMPLETED') {
                await handleOnboarding(sock, remoteJid, user, text);
                return;
            }

            let result: any;
            let mealDescription = text;

            // 1. PROCESAR IMAGEN
            if (isImage) {
                await sock.sendMessage(remoteJid, { text: '📸 Analizando la imagen de tu plato...' });
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                const base64Image = buffer.toString('base64');
                const mimeType = msg.message.imageMessage?.mimetype || 'image/jpeg';

                result = await analyzeMealImage(base64Image, mimeType);
                mealDescription = msg.message.imageMessage?.caption || 'Foto de comida';
            } 
            // 2. PROCESAR AUDIO
            else if (isAudio) {
                await sock.sendMessage(remoteJid, { text: '🎙️ Escuchando tu nota de voz...' });
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                mealDescription = await transcribeAudio(buffer);
                result = await analyzeMealText(mealDescription);
            } 
            // 3. PROCESAR TEXTO
            else {
                const lowerText = text.toLowerCase();

                // MENÚ PRINCIPAL Y AJUSTES
                if (lowerText === 'perfil' || lowerText === 'config' || lowerText === 'ajustes') {
                    const reminderStatus = user.remindersActive 
                        ? `⏰ Activo (${user.reminderTime} hrs)` 
                        : '🔕 Desactivado';

                    const profileText = `⚙️ *Ajustes de Tu Perfil NutriVoice*\n\n` +
                        `👤 *Edad:* ${user.age || 'No configurado'} años\n` +
                        `⚖️ *Peso:* ${user.weightKg || 'No configurado'} kg\n` +
                        `📏 *Estatura:* ${user.heightCm || 'No configurado'} cm\n` +
                        `🎯 *Objetivo:* ${user.goal === 'lose' ? 'Perder peso' : user.goal === 'gain' ? 'Ganar masa' : 'Mantener peso'}\n` +
                        `🔔 *Recordatorios:* ${reminderStatus}\n\n` +
                        `🔥 *Meta Diaria:* ${user.dailyCalories || 2000} kcal\n\n` +
                        `📌 *¿Deseas actualizar algo? Responde con:*\n` +
                        `1️⃣ *PESO* -> Actualizar peso actual\n` +
                        `2️⃣ *OBJETIVO* -> Cambiar meta nutricional\n` +
                        `3️⃣ *REINICIAR* -> Volver a hacer el onboarding\n` +
                        `4️⃣ *RECORDATORIO* -> Configurar tus alertas diarias`;

                    await sock.sendMessage(remoteJid, { text: profileText });
                    return;
                }

                if (lowerText === 'peso' || lowerText === '1') {
                    await prisma.user.update({ where: { id: user.id }, data: { onboardingStep: 'EDIT_WEIGHT' } });
                    await sock.sendMessage(remoteJid, { text: '⚖️ ¿Cuál es tu nuevo peso en kg? (Ej: 72.5)' });
                    return;
                }

                if (lowerText === 'objetivo' || lowerText === '2') {
                    await prisma.user.update({ where: { id: user.id }, data: { onboardingStep: 'EDIT_GOAL' } });
                    await sock.sendMessage(remoteJid, { 
                        text: '🎯 Selecciona tu nuevo objetivo:\n\n1️⃣ Perder peso\n2️⃣ Mantener peso\n3️⃣ Ganar masa muscular\n\n_Responde con 1, 2 o 3_' 
                    });
                    return;
                }

                if (lowerText === 'reiniciar' || lowerText === '3') {
                    await prisma.user.update({ where: { id: user.id }, data: { onboardingStep: 'ASK_AGE' } });
                    await sock.sendMessage(remoteJid, { text: '🔄 Reiniciando perfil... Para comenzar, ¿cuántos años tienes?' });
                    return;
                }

                if (lowerText === 'recordatorio' || lowerText === '4') {
                    await prisma.user.update({ where: { id: user.id }, data: { onboardingStep: 'EDIT_REMINDER_TOGGLE' } });
                    await sock.sendMessage(remoteJid, { 
                        text: '🔔 *Configuración de Recordatorios Diarios*\n\n1️⃣ Activar recordatorios\n2️⃣ Desactivar recordatorios\n\n_Responde con 1 o 2_' 
                    });
                    return;
                }

                if (lowerText === 'resumen' || lowerText === 'hoy') {
                    await sendDailySummary(sock, remoteJid, user.id);
                    return;
                }

                // REGISTRO DE COMIDA HABITUAL POR TEXTO
                result = await analyzeMealText(text);
            }

            if (!result.is_food) {
                await sock.sendMessage(remoteJid, { text: 'Hola 👋, no logré identificar alimentos. Envíame un mensaje de texto, foto o audio describiendo tu comida.' });
                return;
            }

            // Guardar en Base de Datos
            await prisma.meal.create({
                data: {
                    userId: user.id,
                    mealType: result.meal_type || 'comida',
                    description: mealDescription,
                    calories: result.total_calories || 0,
                    proteinG: result.total_protein_g || 0,
                    carbsG: result.total_carbs_g || 0,
                    fatsG: result.total_fats_g || 0
                }
            });

            // Resumen de hoy
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const todayMeals = await prisma.meal.aggregate({
                where: { userId: user.id, createdAt: { gte: today } },
                _sum: { calories: true, proteinG: true, carbsG: true, fatsG: true }
            });

            const consumedCals = todayMeals._sum.calories || 0;
            const consumedProtein = todayMeals._sum.proteinG || 0;
            const consumedCarbs = todayMeals._sum.carbsG || 0;
            const consumedFats = todayMeals._sum.fatsG || 0;

            const remainingMacros = {
                calories: (user.dailyCalories || 2000) - consumedCals,
                protein: (user.dailyProteinG || 150) - consumedProtein,
                carbs: (user.dailyCarbsG || 200) - consumedCarbs,
                fats: (user.dailyFatsG || 60) - consumedFats
            };

            const responseText = await generateUserResponse(mealDescription, result, remainingMacros);
            await sock.sendMessage(remoteJid, { text: responseText });

        } catch (error: any) {
            console.error('❌ Error procesando el mensaje:', error?.message || error);
        }
    });
}

// MANEJO DE ONBOARDING Y CONFIGURACIONES
async function handleOnboarding(sock: any, remoteJid: string, user: any, text: string) {
    if (user.onboardingStep === 'ASK_AGE') {
        const age = parseInt(text);
        if (isNaN(age) || age < 10 || age > 100) {
            await sock.sendMessage(remoteJid, { text: '👋 ¡Bienvenido a NutriVoice! Para comenzar, ¿cuántos años tienes?' });
            return;
        }
        await prisma.user.update({ where: { id: user.id }, data: { age, onboardingStep: 'ASK_WEIGHT' } });
        await sock.sendMessage(remoteJid, { text: 'Perfecto. ¿Cuál es tu peso actual en kilogramos? (Ej: 70.5)' });
        return;
    }

    if (user.onboardingStep === 'ASK_WEIGHT') {
        const weight = parseFloat(text.replace(',', '.'));
        if (isNaN(weight) || weight < 30 || weight > 250) {
            await sock.sendMessage(remoteJid, { text: 'Por favor, ingresa un peso válido en kg. (Ej: 75)' });
            return;
        }
        await prisma.user.update({ where: { id: user.id }, data: { weightKg: weight, onboardingStep: 'ASK_HEIGHT' } });
        await sock.sendMessage(remoteJid, { text: 'Genial. ¿Cuánto mides en centímetros? (Ej: 175)' });
        return;
    }

    if (user.onboardingStep === 'ASK_HEIGHT') {
        const height = parseFloat(text);
        if (isNaN(height) || height < 100 || height > 230) {
            await sock.sendMessage(remoteJid, { text: 'Por favor, ingresa tu estatura en centímetros. (Ej: 170)' });
            return;
        }
        await prisma.user.update({ where: { id: user.id }, data: { heightCm: height, onboardingStep: 'ASK_GOAL' } });
        await sock.sendMessage(remoteJid, { 
            text: '¿Cuál es tu objetivo principal?\n\n1️⃣ Perder peso\n2️⃣ Mantener peso\n3️⃣ Ganar masa muscular\n\n_Responde con 1, 2 o 3_' 
        });
        return;
    }

    if (user.onboardingStep === 'ASK_GOAL') {
        let goal = 'maintain';
        if (text === '1') goal = 'lose';
        if (text === '3') goal = 'gain';

        const macros = calculateMacros(user.age, user.weightKg, user.heightCm, goal);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                goal,
                dailyCalories: macros.targetCalories,
                dailyProteinG: macros.proteinG,
                dailyCarbsG: macros.carbsG,
                dailyFatsG: macros.fatsG,
                onboardingStep: 'ASK_REMINDER'
            }
        });

        await sock.sendMessage(remoteJid, {
            text: `🎯 *¡Perfil Nutricional Guardado!*\n\n` +
                `Meta: *${macros.targetCalories} kcal* diarias.\n\n` +
                `🔔 ¿Quieres activar recordatorios para registrar tu comida del día?\n\n1️⃣ Sí, activar\n2️⃣ No, gracias\n\n_Responde con 1 o 2_`
        });
        return;
    }

    if (user.onboardingStep === 'ASK_REMINDER') {
        if (text === '1') {
            await prisma.user.update({ where: { id: user.id }, data: { onboardingStep: 'ASK_REMINDER_TIME' } });
            await sock.sendMessage(remoteJid, { text: '⏰ ¿A qué hora prefieres recibir el recordatorio? Responde en formato de 24 horas (Ej: 20:30 o 21:00).' });
        } else {
            await prisma.user.update({ where: { id: user.id }, data: { remindersActive: false, onboardingStep: 'COMPLETED' } });
            await sock.sendMessage(remoteJid, { text: '👍 ¡Entendido! Puedes activarlos en cualquier momento escribiendo *CONFIG*.\n\n¡Ya puedes empezar a enviarme fotos, audios o textos de lo que comes!' });
        }
        return;
    }

    if (user.onboardingStep === 'ASK_REMINDER_TIME' || user.onboardingStep === 'EDIT_REMINDER_TIME') {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(text.trim())) {
            await sock.sendMessage(remoteJid, { text: '⚠️ Por favor ingresa una hora válida en formato 24h (Ej: 20:30 o 09:00).' });
            return;
        }

        const formattedTime = text.trim().padStart(5, '0');
        await prisma.user.update({
            where: { id: user.id },
            data: { remindersActive: true, reminderTime: formattedTime, onboardingStep: 'COMPLETED' }
        });

        await sock.sendMessage(remoteJid, { 
            text: `✅ *Recordatorio programado diariamente a las ${formattedTime} hrs.*\n\n¡Todo está listo! Envíame fotos, notas de voz o texto de tus alimentos para llevar tu control.` 
        });
        return;
    }

    if (user.onboardingStep === 'EDIT_WEIGHT') {
        const weight = parseFloat(text.replace(',', '.'));
        if (isNaN(weight) || weight < 30 || weight > 250) {
            await sock.sendMessage(remoteJid, { text: 'Por favor, ingresa un peso válido en kg. (Ej: 72.5)' });
            return;
        }

        const macros = calculateMacros(user.age, weight, user.heightCm, user.goal);
        await prisma.user.update({
            where: { id: user.id },
            data: {
                weightKg: weight,
                dailyCalories: macros.targetCalories,
                dailyProteinG: macros.proteinG,
                dailyCarbsG: macros.carbsG,
                dailyFatsG: macros.fatsG,
                onboardingStep: 'COMPLETED'
            }
        });

        await sock.sendMessage(remoteJid, { text: `✅ *¡Peso actualizado a ${weight} kg!* Meta: ${macros.targetCalories} kcal` });
        return;
    }

    if (user.onboardingStep === 'EDIT_GOAL') {
        let goal = 'maintain';
        if (text === '1') goal = 'lose';
        if (text === '3') goal = 'gain';

        const macros = calculateMacros(user.age, user.weightKg, user.heightCm, goal);
        await prisma.user.update({
            where: { id: user.id },
            data: {
                goal,
                dailyCalories: macros.targetCalories,
                dailyProteinG: macros.proteinG,
                dailyCarbsG: macros.carbsG,
                dailyFatsG: macros.fatsG,
                onboardingStep: 'COMPLETED'
            }
        });

        await sock.sendMessage(remoteJid, { text: `🎯 *¡Objetivo actualizado!* Nueva meta: ${macros.targetCalories} kcal` });
        return;
    }

    if (user.onboardingStep === 'EDIT_REMINDER_TOGGLE') {
        if (text === '1') {
            await prisma.user.update({ where: { id: user.id }, data: { onboardingStep: 'EDIT_REMINDER_TIME' } });
            await sock.sendMessage(remoteJid, { text: '⏰ ¿A qué hora deseas el recordatorio? Usa el formato 24h (Ej: 20:30).' });
        } else {
            await prisma.user.update({ where: { id: user.id }, data: { remindersActive: false, onboardingStep: 'COMPLETED' } });
            await sock.sendMessage(remoteJid, { text: '🔕 Recordatorios desactivados.' });
        }
        return;
    }
}

// PROGRAMADOR AUTOMÁTICO DE RECORDATORIOS (CRON JOB)
function setupReminderCron(sock: any) {
    cron.schedule('* * * * *', async () => {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const currentTime = `${hours}:${minutes}`;

        try {
            const usersToNotify = await prisma.user.findMany({
                where: {
                    remindersActive: true,
                    reminderTime: currentTime,
                    onboardingStep: 'COMPLETED'
                }
            });

            for (const user of usersToNotify) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const mealsCount = await prisma.meal.count({
                    where: { userId: user.id, createdAt: { gte: today } }
                });

                if (mealsCount === 0) {
                    await sock.sendMessage(user.phone, {
                        text: `👋 ¡Hola! Recuerda registrar tus alimentos de hoy en NutriVoice para no perder la secuencia de tus metas. 🥗📸`
                    });
                }
            }
        } catch (e) {
            console.error('Error en el cron de recordatorios:', e);
        }
    });
}

// AUXILIAR RESUMEN DIARIO
async function sendDailySummary(sock: any, remoteJid: string, userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const meals = await prisma.meal.findMany({
        where: { userId, createdAt: { gte: today } },
        orderBy: { createdAt: 'asc' }
    });

    if (meals.length === 0) {
        await sock.sendMessage(remoteJid, { text: 'Aún no has registrado comidas el día de hoy.' });
        return;
    }

    let totalCals = 0;
    let summaryText = `📅 *Resumen Nutricional de Hoy*\n\n`;

    meals.forEach((m) => {
        totalCals += m.calories;
        summaryText += `• *${m.mealType.toUpperCase()}:* ${m.calories} kcal (${m.description})\n`;
    });

    summaryText += `\n🔥 *Total Acumulado:* ${totalCals} kcal`;
    await sock.sendMessage(remoteJid, { text: summaryText });
}

connectToWhatsApp();
