"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/auth/types";

// show — кому вкладка: джуну «Интеграций» нет вовсе, AI-доступ — если включили (060_junior.sql).
// Это только вкладки: сами страницы и их API режут middleware и requireRole.
const TABS: { href: string; label: string; show?: (role: UserRole, mcp: boolean) => boolean }[] = [
  { href: "/settings", label: "Профиль" },
  { href: "/settings/integrations", label: "Интеграции", show: (r) => r !== "junior" },
  { href: "/settings/ai", label: "AI-доступ", show: (r, mcp) => r !== "junior" || mcp },
  { href: "/settings/juniors", label: "Джуны", show: (r) => r === "buyer" },
  { href: "/settings/team", label: "Команда", show: (r) => r === "main" },
  { href: "/settings/invites", label: "Приглашения", show: (r) => r === "main" },
];

export default function SettingsNav({ role, mcp }: { role: UserRole; mcp: boolean }) {
  const pathname = usePathname();

  return (
    <div className="seg mb-6">
      {TABS.filter((t) => !t.show || t.show(role, mcp)).map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            // Страницы динамические, и без явного prefetch Next тянет только
            // границу loading. С ним разметка приезжает заранее, по наведению.
            prefetch
            className="seg-btn"
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
