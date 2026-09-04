import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
}

/**
 * Minimum password policy enforced at signup / reset / import time. Kept
 * server-side only so it cannot be bypassed by a modified client.
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 12) errors.push("密碼長度至少需 12 個字元");
  if (!/[a-z]/.test(password)) errors.push("密碼需包含至少一個小寫字母");
  if (!/[A-Z]/.test(password)) errors.push("密碼需包含至少一個大寫字母");
  if (!/[0-9]/.test(password)) errors.push("密碼需包含至少一個數字");
  if (!/[^a-zA-Z0-9]/.test(password)) errors.push("密碼需包含至少一個特殊符號");
  return { ok: errors.length === 0, errors };
}
