import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LogoutButton } from "./LogoutButton";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/dashboard" className="font-bold text-slate-900 hover:text-brand-600">
            部門費用預算編列系統
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              {user.name}（{user.role}）
            </span>
            <Link href="/dashboard/reports" className="text-sm text-brand-600 hover:underline">
              報表
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
