import crypto from "node:crypto";

/**
 * A fresh, high-entropy (32 random bytes) invitation token. Returned to the
 * caller exactly once (see createInvitation) - nothing in this codebase
 * persists the plaintext value anywhere, including logs.
 */
export function generateInvitationToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** sha256 hex digest - the only form of the token ever written to the database (Invitation.tokenHash), mirroring PasswordResetToken's own convention. */
export function hashInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
