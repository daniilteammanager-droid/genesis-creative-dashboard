"use client";

import { useEffect, useState } from "react";
import type { TgadsKeyView } from "@/lib/connections/tgadsKeys";

// Кабинеты Telegram Ads (Decision 068): строка на кабинет — название и ключ API.
// Своя карточка, параллельно источнику Facebook: площадки не пересекаются (Decision 069).

const field =
  "w-full bg-panel border border-line rounded-xl px-4 py-3 outline-none " +
  "focus:border-violet-600/50 transition placeholder:text-hint text-white text-sm";
const card = "bg-card border border-line rounded-2xl p-6";
const pill = "text-[11px] px-2.5 py-1 rounded-full border transition disabled:opacity-50";
const date = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function TgadsKeys() {
  const [keys, setKeys] = useState<TgadsKeyView[]>([]);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/tgads-keys").then((r) => r.json()).then((d) => d.keys && setKeys(d.keys)).catch(() => undefined);
  }, []);

  async function call(init: RequestInit, url: string, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, init);
      const d = (await res.json().catch(() => null)) as { keys?: TgadsKeyView[]; error?: string } | null;
      if (!res.ok || !d?.keys) throw new Error(d?.error ?? "Не получилось — попробуй ещё раз");
      setKeys(d.keys);
      setMsg({ ok: true, text: ok });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Сеть не ответила" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const done = await call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, token }) },
      "/api/tgads-keys", "Кабинет подключён. Расход и история за неделю подтянутся в течение пары минут, остальное догрузится само");
    if (done) { setName(""); setToken(""); }
  }

  return (
    <div className={card}>
      <h2 className="text-lg font-semibold text-white mb-2">Telegram Ads</h2>
      <p className="text-sm text-zinc-400 leading-relaxed mb-4">
        Расход TG Ads — отдельно от Facebook и вместе с ним: можно лить и туда и туда. Кабинет — строкой:
        название и ключ API. В название впиши лицо (ROMAN, RICKY) — по нему чек разложит кабинет.
      </p>
      {keys.length > 0 && (
        <div className="divide-y divide-line border border-line rounded-xl mb-4">
          {keys.map((k) => (
            <div key={k.id} className="px-4 py-3 flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <p className="text-sm text-zinc-200">{k.name} <span className="text-hint">{k.hint}</span></p>
                <p className="text-[11px] text-hint mt-0.5">
                  {k.accountTitle} · {k.currency}{k.lastOkAt && ` · работал ${date(k.lastOkAt)}`}
                </p>
                {k.lastError && <p className="text-[11px] text-red-300 mt-1">Последняя ошибка: {k.lastError}</p>}
              </div>
              <button type="button" disabled={busy}
                      onClick={() => confirm === k.id
                        ? call({ method: "DELETE" }, `/api/tgads-keys?id=${k.id}`, "Кабинет отключён. История в дашборде осталась").then(() => setConfirm(null))
                        : setConfirm(k.id)}
                      className={`${pill} border-red-800/40 text-red-300 hover:bg-red-900/20`}>
                {confirm === k.id ? "точно удалить?" : "удалить"}
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add} className="space-y-2.5">
        <input type="text" placeholder="Название, например «TG ADS Испания ROMAN»" value={name}
               onChange={(e) => setName(e.target.value)} className={field} />
        <input type="password" placeholder="Ключ API Telegram Ads" value={token} autoComplete="off"
               onChange={(e) => setToken(e.target.value)} className={field} />
        <button type="submit" disabled={busy || !token.trim()}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50">
          {busy ? "Проверяю…" : keys.length ? "Добавить ещё кабинет" : "Подключить Telegram Ads"}
        </button>
      </form>
      <p className="text-[11px] text-hint leading-relaxed mt-2">
        Ключ — в настройках кабинета Telegram Ads, раздел Ads API. Кабинет на строку: добавил новый кабинет —
        добавь его ключ. Расход в TON переводится в доллары по курсу Coinbase своего дня. Страна — из названия
        объявления: «Static 2 Mexico», «Snow 1 Spain».
      </p>

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm border mt-3 ${
          msg.ok ? "bg-green-950/30 border-green-700/30 text-green-300" : "bg-red-950/40 border-red-700/30 text-red-300"
        }`}>{msg.text}</div>
      )}
    </div>
  );
}
