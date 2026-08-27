import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function getOrCreateUser(phone: string, isPro: boolean = false) {
  let user = await prisma.user.findUnique({
    where: { phone }
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        phone,
        isPro,
        onboardingStep: 'name'
      }
    });
  }

  return user;
}

export async function updateUser(phone: string, data: Record<string, any>) {
  return await prisma.user.update({
    where: { phone },
    data
  });
}

export async function updateUserOnboardingStep(phone: string, step: string) {
  return await prisma.user.update({
    where: { phone },
    data: { onboardingStep: step }
  });
}
