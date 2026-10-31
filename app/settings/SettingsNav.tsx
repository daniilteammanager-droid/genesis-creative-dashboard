"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings", label: "Профиль" },
  { href: "/settings/integrations", label: "Интеграции" },
  { href: "/settings/team", label: "Команда", mainOnly: true },
  { href: "/settings/invites", label: "Приглашения", mainOnly: true },
];

export default function SettingsNav({ isMain }: { isMain: boolean }) {
  const pathname = usePathname();

  return (
    <div className="seg mb-6">
      {TABS.filter((t) => isMain || !t.mainOnly).map((t) => {
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
