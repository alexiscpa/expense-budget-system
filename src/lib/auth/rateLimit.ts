import { prisma } from "@/lib/prisma";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function isAccountLocked(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { lockedUntil: true } });
  if (!user?.lockedUntil) return false;
  return user.lockedUntil.getTime() > Date.now();
}

export async function recordLoginFailure(email: string, userId: string | null, ipAddress: string | null) {
  await prisma.loginAttempt.create({ data: { email, success: false, ipAddress } });
  if (!userId) return;

  const user = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
  });

  if (user.failedLoginCount >= MAX_FAILED_ATTEMPTS) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000),
      },
    });
  }
}

export async function recordLoginSuccess(email: string, userId: string, ipAddress: string | null) {
  await prisma.loginAttempt.create({ data: { email, success: true, ipAddress } });
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}
