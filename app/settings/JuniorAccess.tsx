"use client";

import { WORK_AREAS, juniorDefault } from "@/lib/nav";
import { chip, seg } from "@/components/ui";

// Разделы и AI-доступ джуна (060_junior.sql) — одни и те же на «Команде» у владельца и на «Джунах» у баера.
// allowed — разделы баера: больше, чем видит баер, джуну не открыть (закрытое — серым, с причиной).
export default function JuniorAccess({ chosen, allowed, mcp, busy, onAreas, onMcp }: {
  chosen: string[] | null;
  allowed: string[];
  mcp: boolean;
  busy: boolean;
  onAreas: (areas: string[] | null) => void;
  onMcp: (on: boolean) => void;
}) {
  const now = chosen ?? juniorDefault();
  const toggle = (href: string) => onAreas(now.includes(href) ? now.filter((h) => h !== href) : [...now, href]);
  return (
    <>
      <div className="w-full flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-hint whitespace-nowrap w-[72px]">Разделы</span>
        {WORK_AREAS.map((a) => {
          const closed = !allowed.includes(a.href);
          return (
            <button key={a.href} type="button" {...chip(!closed && now.includes(a.href))} disabled={busy || closed}
              title={closed ? "Закрыто у баера" : undefined} onClick={() => toggle(a.href)}
              className="chip disabled:opacity-45 disabled:cursor-not-allowed">
              {a.label}
            </button>
          );
        })}
        {chosen && (
          <button type="button" disabled={busy} onClick={() => onAreas(null)} className="text-[11px] text-hint hover:text-white underline-offset-2 hover:underline">
            как по умолчанию
          </button>
        )}
      </div>
      <div className="w-full flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-hint whitespace-nowrap w-[72px]">AI-доступ</span>
        <div className="seg">
          {([false, true] as const).map((on) => (
            <button key={String(on)} type="button" {...seg(mcp === on)} disabled={busy} onClick={() => mcp !== on && onMcp(on)}>
              {on ? "Включён" : "Выключен"}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-hint">свой Claude или Codex — только по открытым разделам</span>
      </div>
    </>
  );
}
