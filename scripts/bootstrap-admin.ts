/**
 * One-time operational script to create the first SYSTEM_ADMIN account so
 * someone can log in and start importing real master data (departments,
 * accounts, users) through the controlled import flows.
 *
 * This is NOT run automatically during build or deploy (see
 * OPERATIONS.md). Run it manually, once, against the target database:
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' ADMIN_NAME='...' \
 *     npm run bootstrap:admin
 *
 * The password is read from an environment variable, never hardcoded or
 * logged, and must satisfy the same password policy enforced everywhere
 * else in the app.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword, checkPasswordPolicy } from "../src/lib/auth/password";

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "System Administrator";

  if (!email || !password) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required");
    process.exit(1);
  }

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    console.error("Password does not meet policy:", policy.errors.join("; "));
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.upsert({
      where: { email: email.toLowerCase() },
      update: { passwordHash, role: "SYSTEM_ADMIN", companyWide: true, isActive: true },
      create: {
        email: email.toLowerCase(),
        name,
        passwordHash,
        role: "SYSTEM_ADMIN",
        companyWide: true,
      },
    });
    console.log(`SYSTEM_ADMIN ready: ${user.email} (id=${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Bootstrap failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
