"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/client";
import JuniorAccess from "../JuniorAccess";

export interface Junior {
  id: string;
  name: string | null;
  email: string;
  status: "active" | "disabled";
  junior_areas: string[] | null;
  junior_mcp: boolean;
  created_at: string;
}

// Свои джуны баера: разделы и AI-доступ — функцией buyer_update_junior (только своим), ссылка новому — junior_invite.
export default function JuniorsManager({ juniors, allowed }: { juniors: Junior[]; allowed: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function update(id: string, patch: Record<string, unknown>) {
    setBusy(id); setError(null);
    const { error } = await createClient().rpc("buyer_update_junior", { p_id: id, ...patch });
    setBusy(null);
    if (error) { setError(error.message); return; }
    router.refresh();
  }

  async function invite() {
    setBusy("invite"); setError(null); setCopied(false);
    const { data, error } = await createClient().rpc("junior_invite", { p_note: note.trim() || null, p_days: 7 });
    setBusy(null);
    if (error) { setError(error.message); return; }
    const url = `${window.location.origin}/login?invite=${data as string}`;
    setLink(url);
    setNote("");
    // Сразу в буфер: ссылка бесполезна, пока её не отправили джуну.
    await navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => {});
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {juniors.length > 0 && (
        <div className="card divide-y divide-line">
          {juniors.map((j) => (
            <div key={j.id} className="flex items-center gap-3 px-5 py-4 flex-wrap">
              <div className="min-w-[180px] flex-1">
                <p className="text-sm text-zinc-200 truncate">{j.name || "без имени"}</p>
                <p className="text-[11px] text-hint truncate">{j.email} · джун с {new Date(j.created_at).toLocaleDateString("ru-RU")}</p>
              </div>
              <span className={`text-[11px] px-2.5 py-1 rounded-full border ${j.status === "active"
                ? "bg-green-900/30 text-green-400 border-green-800/30" : "bg-zinc-800/50 text-hint border-zinc-700/40"}`}>
                {j.status === "active" ? "активен" : "отключён"}
              </span>
              {busy === j.id && <span className="text-[11px] text-hint">…</span>}
              <JuniorAccess chosen={j.junior_areas} allowed={allowed} mcp={j.junior_mcp} busy={busy === j.id}
                onAreas={(areas) => update(j.id, areas ? { p_areas: areas } : { p_reset_areas: true })}
                onMcp={(on) => update(j.id, { p_mcp: on })} />
            </div>
          ))}
        </div>
      )}

      <div className="card p-5 space-y-3">
        <p className="text-sm font-medium text-white">Новый джун</p>
        <div className="flex flex-wrap gap-2 items-center">
          <input type="text" placeholder="Для кого: имя джуна" value={note} onChange={(e) => setNote(e.target.value)}
            className="field flex-1 min-w-[200px]" aria-label="Для кого ссылка" />
          <button type="button" disabled={busy === "invite"} onClick={invite} className="btn btn-primary">
            {busy === "invite" ? "Секунду…" : "Ссылка для джуна"}
          </button>
        </div>
        {link && (
          <div className="flex flex-wrap gap-2 items-center">
            <input readOnly value={link} className="field flex-1 min-w-[200px] font-mono text-xs" aria-label="Ссылка-приглашение" />
            <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>
              {copied ? "Скопировано" : "Копировать"}
            </button>
          </div>
        )}
        <p className="text-[11px] text-hint">
          Одноразовая, на 7 дней. По ней регистрируются только джуном к тебе; разделы — по умолчанию (без General 4.0 и
          Пополнений), AI-доступ выключен.
        </p>
      </div>
    </div>
  );
}
