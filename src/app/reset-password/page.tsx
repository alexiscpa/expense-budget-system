import { ResetPasswordClient } from "./ResetPasswordClient";

// Driven entirely by the request's own ?token= query string - never a
// candidate for static generation. Thin server-component wrapper (matches
// app/login/page.tsx's own LoginForm split) so this route's static-shell
// generation never touches a "use client" default export directly.
export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return <ResetPasswordClient />;
}
