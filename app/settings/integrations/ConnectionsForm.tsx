"use client";

import { useState } from "react";
import type { ConnectionView } from "@/lib/connections/store";

const TORRO_HELP =
  "https://torrocrm.com/ru/help/nastroika-analitiki-i-trekinga/nastroika-avtomaticheskoi-vygruzki-dannykh-iz-mvp-v-google-sheets";

const field =
  "w-full bg-[#0d0b14] border border-violet-900/40 rounded-xl px-4 py-3 outline-none " +
  "focus:border-violet-600/50 transition placeholder:text-zinc-600 text-white text-sm";

const card = "bg-[#111118] border border-violet-900/30 rounded-2xl p-6";

export default function ConnectionsForm({
  initial,
  loadError,
  serviceAccount,
  grSheetId,
}: {
  initial: ConnectionView | null;
  loadError: string | null;
  serviceAccount: string | null;
  grSheetId: string | null;
}) {
  const [view, setView] = useState(initial);
  const [metaToken, setMetaToken] = useState("");
  const [campaigns, setCampaigns] = useState(initial?.crmCampaignsUrl ?? "");
  const [ads, setAds] = useState(initial?.crmAdsSheetId ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);

    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Пустое поле ключа — «не трогать», а не «удалить»: прочитать его назад
        // нельзя, поэтому оно всегда пустое при открытии страницы.
        ...(metaToken.trim() ? { metaToken: metaToken.trim() } : {}),
        crmCampaignsUrl: campaigns.trim() || null,
        crmAdsSheetId: ads.trim() || null,
      }),
    });
    const data = (await res.json()) as ConnectionView & { error?: string };
    setBusy(false);

    if (!res.ok) { setMsg({ ok: false, text: data.error ?? "Не удалось сохранить" }); return; }
    setView(data);
    setMetaToken("");
    setMsg({ ok: true, text: "Проверено и сохранено" });
  }

  async function disconnectMeta() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metaToken: null }),
    });
    const data = (await res.json()) as ConnectionView & { error?: string };
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: data.error ?? "Не удалось отключить" }); return; }
    setView(data);
    setMsg({ ok: true, text: "Ключ удалён" });
  }

  if (loadError) {
    return (
      <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm">
        {loadError}
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className={card}>
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h2 className="text-lg font-semibold text-white">Ключ Meta</h2>
          {view?.metaConnected && (
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-green-900/30 text-green-400 border border-green-800/30">
              подключено {view.metaHint}
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-400 leading-relaxed mb-4">
          По нему собирается твой расход, показы, клики и статусы в Reports.
        </p>

        <input
          type="password"
          placeholder={view?.metaConnected ? "Вставь новый ключ, чтобы заменить" : "Токен доступа"}
          value={metaToken}
          onChange={(e) => setMetaToken(e.target.value)}
          autoComplete="off"
          className={field}
        />

        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {view?.metaConnected && (
            <button type="button" onClick={disconnectMeta} disabled={busy}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-red-800/40 text-red-300 hover:bg-red-900/20 transition disabled:opacity-50">
              удалить ключ
            </button>
          )}
          <p className="text-[11px] text-zinc-600 leading-relaxed">
            Ключ проверяется при сохранении и обратно не читается — ни интерфейсом, ни мной.
            Забыл — вставь новый.
          </p>
        </div>
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-white mb-2">Выгрузки Torro CRM</h2>
        <p className="text-sm text-zinc-400 leading-relaxed mb-1">
          Депозиты и доходы. Две выгрузки: по кампаниям и по объявлениям.
        </p>
        <p className="text-[13px] text-zinc-600 leading-relaxed mb-4">
          Как их настроить —{" "}
          <a href={TORRO_HELP} target="_blank" rel="noreferrer" className="text-violet-400 hover:text-violet-300 underline">
            инструкция Torro
          </a>
          .{serviceAccount && (
            <>
              {" "}Свою таблицу открой на чтение для{" "}
              <code className="text-zinc-400 break-all">{serviceAccount}</code> — иначе мы её не прочитаем.
            </>
          )}
        </p>

        <label className="block text-[11px] text-zinc-600 mb-1">Кампании — ссылка на XLSX</label>
        <input type="text" placeholder="https://..." value={campaigns}
               onChange={(e) => setCampaigns(e.target.value)} className={`${field} mb-3`} />

        <label className="block text-[11px] text-zinc-600 mb-1">Объявления — ключ таблицы</label>
        <input type="text" placeholder="1AbC…" value={ads}
               onChange={(e) => setAds(e.target.value)} className={field} />
        <p className="text-[11px] text-zinc-600 leading-relaxed mt-2">
          Ключ таблицы — кусок её адреса между <code>/d/</code> и <code>/edit</code>.
        </p>
      </div>

      <div className={card}>
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h2 className="text-lg font-semibold text-white">Таблица General Report 3.0</h2>
          <span className={`text-[11px] px-2.5 py-1 rounded-full border ${
            grSheetId
              ? "bg-green-900/30 text-green-400 border-green-800/30"
              : "bg-zinc-800/60 text-zinc-500 border-zinc-700/40"
          }`}>
            {grSheetId ? "подключена" : "не подключена"}
          </span>
        </div>
        <p className="text-sm text-zinc-400 leading-relaxed">
          Её заводит и подключает владелец — таблицы его, и доступ к ним выдаёт он.
          Здесь показано только состояние.
        </p>
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${
          msg.ok ? "bg-green-950/30 border-green-700/30 text-green-300"
                 : "bg-red-950/40 border-red-700/30 text-red-300"
        }`}>
          {msg.text}
        </div>
      )}

      <button type="submit" disabled={busy}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50">
        {busy ? "Проверяю…" : "Проверить и сохранить"}
      </button>
    </form>
  );
}
