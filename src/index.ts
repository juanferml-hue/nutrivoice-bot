async function main() {
    try {
        console.log('🔄 Sincronizando esquema de base de datos...');
        await prisma.$executeRawUnsafe(`SELECT 1`); // Verifica conexión
    } catch (e) {
        console.log('Esperando conexión con DB...');
    }
}
import crypto from 'crypto';
if (!globalThis.crypto) {
    (globalThis as any).crypto = crypto;
}

import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import http from 'http';
import { analyzeMealText, generateUserResponse } from './services/aiService';
import { prisma, getOrCreateUser, calculateMacros } from './services/userService';

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
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

        if (!text || !remoteJid) return;

        try {
            const user = await getOrCreateUser(remoteJid);

            // FLUJO DE ONBOARDING
            if (user.onboardingStep !== 'COMPLETED') {
                await handleOnboarding(sock, remoteJid, user, text);
                return;
            }

            // COMANDOS ESPECIALES
            if (text.toLowerCase() === 'resumen' || text.toLowerCase() === 'hoy') {
                await sendDailySummary(sock, remoteJid, user.id);
                return;
            }

            // REGISTRO DE COMIDA HABITUAL
            const result = await analyzeMealText(text);

            if (!result.is_food) {
                await sock.sendMessage(remoteJid, { text: 'Hola 👋, envíame lo que comiste para registrarlo, o escribe *RESUMEN* para ver tus calorías de hoy.' });
                return;
            }

            // Guardar comida en Base de Datos
            await prisma.meal.create({
                data: {
                    userId: user.id,
                    mealType: result.meal_type || 'comida',
                    description: text,
                    calories: result.total_calories || 0,
                    proteinG: result.total_protein_g || 0,
                    carbsG: result.total_carbs_g || 0,
                    fatsG: result.total_fats_g || 0
                }
            });

            // Obtener acumulado de hoy
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const todayMeals = await prisma.meal.aggregate({
                where: {
                    userId: user.id,
                    createdAt: { gte: today }
                },
                _sum: { calories: true, proteinG: true, carbsG: true, fatsG: true }
            });

            // Calcular saldo restante del día
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

            // Generar respuesta conversacional inteligente con la personalidad deseada
            const responseText = await generateUserResponse(
                text,
                result,
                remainingMacros
            );

            await sock.sendMessage(remoteJid, { text: responseText });

        } catch (error: any) {
            console.error('❌ Error procesando el mensaje:', error?.message || error);
        }
    });
}

// Función auxiliar para el Onboarding
async function handleOnboarding(sock: any, remoteJid: string, user: any, text: string) {
    if (user.onboardingStep === 'ASK_AGE') {
        const age = parseInt(text);
        if (isNaN(age) || age < 10 || age > 100) {
            await sock.sendMessage(remoteJid, { text: '👋 ¡Bienvenido a NutriVoice! Para personalizar tu plan, ¿cuántos años tienes?' });
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
                onboardingStep: 'COMPLETED'
            }
        });

        await sock.sendMessage(remoteJid, {
            text: `🎯 *¡Perfil Configurado con Éxito!*\n\n` +
                `Tu meta diaria estimada es:\n` +
                `🔥 *Calorías:* ${macros.targetCalories} kcal\n` +
                `🥩 *Proteínas:* ${macros.proteinG}g\n` +
                `🍞 *Carbohidratos:* ${macros.carbsG}g\n` +
                `🥑 *Grasas:* ${macros.fatsG}g\n\n` +
                `¡Ya puedes empezar a enviarme lo que comes!`
        });
    }
}

// Función auxiliar para el Resumen Diario
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
