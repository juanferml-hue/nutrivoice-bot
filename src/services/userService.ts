import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Calcular metas diarias basadas en Mifflin-St Jeor
export function calculateMacros(age: number, weightKg: number, heightCm: number, goal: string) {
    // Tasa Metabólica Basal (estimación promedio)
    let bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5; 
    let targetCalories = Math.round(bmr * 1.375); // Factor de actividad moderada baja

    if (goal === 'lose') targetCalories -= 400;
    if (goal === 'gain') targetCalories += 300;

    const proteinG = Math.round((targetCalories * 0.30) / 4);
    const carbsG = Math.round((targetCalories * 0.40) / 4);
    const fatsG = Math.round((targetCalories * 0.30) / 9);

    return { targetCalories, proteinG, carbsG, fatsG };
}

export async function getOrCreateUser(phone: String) {
    const userPhone = phone.toString();
    let user = await prisma.user.findUnique({ where: { phone: userPhone } });

    if (!user) {
        user = await prisma.user.create({
            data: {
                phone: userPhone,
                onboardingStep: 'ASK_AGE'
            }
        });
    }

    return user;
}
