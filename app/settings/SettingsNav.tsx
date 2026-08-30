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
    <div className="flex gap-1 mb-6 bg-[#111118] border border-violet-900/40 rounded-2xl p-1 w-fit flex-wrap">
      {TABS.filter((t) => isMain || !t.mainOnly).map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${
              active
                ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
                : "text-zinc-400 hover:text-violet-300"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
