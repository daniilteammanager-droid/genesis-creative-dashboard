"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/client";
import { normalizeBuyerCode, type UserRole } from "@/lib/auth/types";

export interface Invite {
  token: string;
  role: UserRole;
  buyer_code: string | null;
  note: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

// 20 hex-символов, 80 бит случайности. Подобрать перебором нереально, а в ссылку
// помещается без переносов.
function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

function inviteLink(token: string): string {
  return `${window.location.origin}/login?invite=${token}`;
}

export default function InviteManager({ invites }: { invites: Invite[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [role, setRole] = useState<UserRole>("buyer");
  const [days, setDays] = useState(14);
  const [buyerCode, setBuyerCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Тот же вид, что проверяет база (003_admin.sql). Без проверки здесь кривой код
    // молча ложится в приглашение, а спотыкается об него уже приглашённый — при
    // регистрации, и без внятного объяснения.
    const code = normalizeBuyerCode(buyerCode);
    if (role === "buyer" && code && !/^b[0-9]+$/.test(code)) {
      setBusy(false);
      setError("Номер — это цифра: 1 или b1");
      return;
    }

    const token = newToken();
    const expires = new Date(Date.now() + days * 86_400_000).toISOString();

    const { error } = await supabase.from("invites").insert({
      token, role, note: note.trim() || null, created_by: user?.id ?? null, expires_at: expires,
      // Номер задаётся здесь, а не правится после регистрации: действующим баерам
      // нужны их настоящие b1–b4, а последовательность выдала бы следующий свободный.
      buyer_code: role === "buyer" && code ? code : null,
    });
    setBusy(false);

    if (error) { setError(error.message); return; }
    setNote("");
    setBuyerCode("");
    // Список живёт на сервере — просим Next перечитать страницу.
    router.refresh();
    // Сразу в буфер: приглашение бесполезно, пока его не отправили человеку.
    await navigator.clipboard.writeText(inviteLink(token)).catch(() => {});
    setCopied(token);
  }

  async function copy(token: string) {
    await navigator.clipboard.writeText(inviteLink(token)).catch(() => {});
    setCopied(token);
  }

  function status(i: Invite): { label: string; cls: string } {
    if (i.used_at) return { label: "использовано", cls: "bg-zinc-800/50 text-zinc-500 border-zinc-700/40" };
    if (new Date(i.expires_at) <= new Date()) return { label: "просрочено", cls: "bg-red-900/30 text-red-400 border-red-800/30" };
    return { label: "активно", cls: "bg-green-900/30 text-green-400 border-green-800/30" };
  }

  const field =
    "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none " +
    "focus:border-violet-600/50 transition placeholder:text-zinc-600 text-white";

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="bg-[#111118] border border-violet-900/30 rounded-2xl p-5">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-zinc-500 mb-1.5">Для кого</label>
            <input
              type="text"
              placeholder="Новый баер, выходит с понедельника"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={`${field} w-full`}
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Роль</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={`${field} cursor-pointer`}>
              <option value="buyer">Баер</option>
              <option value="teamlead">Тимлид</option>
            </select>
          </div>
          {role === "buyer" && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Номер</label>
              <input
                type="text"
                placeholder="1"
                value={buyerCode}
                onChange={(e) => setBuyerCode(e.target.value)}
                className={`${field} w-20`}
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Живёт, дней</label>
            <input
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className={`${field} w-24`}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50"
          >
            {busy ? "Секунду…" : "Создать ссылку"}
          </button>
        </div>
        <p className="text-[11px] text-zinc-600 mt-3">
          Ссылка копируется в буфер сразу после создания. Роль «владелец» через приглашения не выдаётся.
          Номер оставь пустым — присвоится следующий свободный.
        </p>
      </form>

      {error && (
        <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      <div className="bg-[#111118] border border-violet-900/30 rounded-2xl divide-y divide-violet-900/20">
        {invites.length === 0 && <p className="text-sm text-zinc-600 p-5">Пока ни одного приглашения.</p>}
        {invites.map((i) => {
          const s = status(i);
          const active = !i.used_at && new Date(i.expires_at) > new Date();
          return (
            <div key={i.token} className="flex items-center gap-3 px-5 py-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-200 truncate">{i.note || "без пометки"}</p>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  {i.role === "teamlead" ? "тимлид" : "баер"}
                  {i.buyer_code ? ` ${i.buyer_code}` : ""} · до{" "}
                  {new Date(i.expires_at).toLocaleDateString("ru-RU")}
                </p>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
              {active && (
                <button
                  onClick={() => copy(i.token)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-violet-900/40 text-zinc-300 hover:border-violet-600/50 transition"
                >
                  {copied === i.token ? "Скопировано" : "Копировать ссылку"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
