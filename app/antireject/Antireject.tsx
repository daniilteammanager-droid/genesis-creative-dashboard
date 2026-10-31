"use client";

import { useCallback, useEffect, useState } from "react";

// «Антиотклон» (Decision 083, 091) — как вкладка Артёма: отклонённые объявления своих
// кабинетов, действия прямо отсюда (ссылка, ФП, Multi-advertiser — выбор, проверка,
// подтверждение; уникализация с заменой видео), история и лендинги Torro. Уникализация
// из библиотеки — своя вкладка «Уникализация».

const card = "bg-card border border-line rounded-2xl p-5";
const field = "bg-panel border border-line rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-600/50 text-white";
const small = "px-3 py-1.5 rounded-lg text-sm border transition disabled:opacity-50";

interface Rejected { ad_id: string; account_id: string; ad_name: string | null; campaign_name: string | null; status: string; reason: string | null; first_seen_at: string }
interface Event { id: string; created_at: string; kind: "rejected" | "action"; ad_id: string; ad_name: string | null; campaign_name: string | null; actor: string | null; text: string | null; ok: boolean | null; status: string | null }
interface View {
  rejected: Rejected[]; events: Event[]; types: Record<string, string>;
  landings: { id: number; name: string; url: string; series: string | null }[]; checkedAt: string | null;
}
type Kind = "link" | "page" | "multi";
const KIND: Record<Kind, string> = { link: "🔗 Заменить ссылку", page: "📄 Поменять ФП", multi: "🔁 Multi-advertiser" };
const SERIES: Record<string, string> = { spain: "Испания", latam: "Латам", riki: "Рики" };
interface Panel {
  adId: string; kind: Kind; loading: boolean; error?: string;
  now?: string; reason?: string | null; choices?: { value: string; label: string }[];
  confirm?: { nonce: string; describe: string }; done?: string;
}

const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const post = (body: Record<string, unknown>) =>
  fetch("/api/antireject", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok || d.error) throw new Error(d.error ?? "Не получилось"); return d; });

export default function Antireject() {
  const [v, setV] = useState<View | null>(null);
  const [tail, setTail] = useState("nature");
  const [frame, setFrame] = useState("nature");
  const [note, setNote] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [scanning, setScanning] = useState(false);
  const load = useCallback(() => fetch("/api/antireject").then((r) => r.json()).then((d) => d.rejected && setV(d)).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);

  async function open(adId: string, kind: Kind) {
    setPanel({ adId, kind, loading: true });
    try { setPanel({ adId, kind, loading: false, ...(await post({ op: "options", adId, kind })) }); }
    catch (e) { setPanel({ adId, kind, loading: false, error: (e as Error).message }); }
  }
  async function choose(value: string) {
    if (!panel) return;
    setPanel({ ...panel, loading: true, error: undefined });
    try { const d = await post({ op: "preview", adId: panel.adId, kind: panel.kind, value }); setPanel({ ...panel, loading: false, confirm: { nonce: d.nonce, describe: d.describe } }); }
    catch (e) { setPanel({ ...panel, loading: false, error: (e as Error).message }); }
  }
  async function confirm() {
    if (!panel?.confirm) return;
    setPanel({ ...panel, loading: true, error: undefined });
    try {
      const d = await post({ op: "confirm", nonce: panel.confirm.nonce });
      setPanel({ ...panel, loading: false, confirm: undefined, done: `Meta приняла: ${d.describe}. Статус: ${d.status} — объявление ушло на повторную проверку.` });
      load();
    } catch (e) { setPanel({ ...panel, loading: false, error: (e as Error).message }); }
  }
  async function uniq(adId: string) {
    setNote(null);
    try { await post({ op: "start", adId, tail, frame }); setNote("В очереди — монтаж 7–10 минут, ход — во вкладке «Уникализация», новое видео встанет в объявление само"); }
    catch (e) { setNote((e as Error).message); }
  }
  async function scan() {
    setScanning(true); setNote(null);
    try { const d = await post({ op: "scan" }); setNote(`Проверено кабинетов: ${d.accounts}. Отклонённых: ${d.rejected}, новых: ${d.fresh}${d.failedAccounts ? `, не прочитались: ${d.failedAccounts}` : ""}`); load(); }
    catch (e) { setNote((e as Error).message); }
    finally { setScanning(false); }
  }

  if (!v) return <div className="w-full px-4 md:px-8 py-6 text-hint">Загружаю…</div>;
  const pick = (label: string, value: string, set: (s: string) => void) => (
    <label className="flex items-center gap-2 text-xs text-hint">{label}
      <select value={value} onChange={(e) => set(e.target.value)} className={field}>{Object.entries(v.types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </label>
  );

  return (
    <div className="w-full px-4 md:px-8 py-6 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-white">Антиотклон</h1>
          <p className="text-sm text-hint mt-1">Отклонённые объявления твоих кабинетов. Выбери действие, проверь изменение и подтверди — то же, что кнопки под алертом в боте.</p>
        </div>
        <button type="button" disabled={scanning} onClick={scan} className={`${small} border-violet-700/50 text-violet-200 py-2`}>{scanning ? "Проверяю…" : "↻ Проверить сейчас"}</button>
      </div>

      <div data-tour="ar-settings" className={`${card} flex flex-wrap gap-3 items-center`}>
        <span className="text-sm text-zinc-300">Мониторинг: каждые 15 минут{v.checkedAt ? `, последний прогон ${when(v.checkedAt)}` : ""}. Новое отклонение — алерт владельцу кабинета в Telegram.</span>
        <span className="text-[11px] text-hint w-full">Уникализация по объявлению:</span>
        {pick("после 30 с чёрного", tail, setTail)}
        {pick("кадры до и после", frame, setFrame)}
      </div>
      {note && <div className="bg-violet-950/30 border border-violet-800/30 rounded-xl px-4 py-2.5 text-violet-100/90 text-sm">{note}</div>}

      <div data-tour="ar-rejected" className={card}>
        <h2 className="text-base font-semibold text-white mb-3">Отклонённые объявления · {v.rejected.length}</h2>
        {v.rejected.length === 0 ? <p className="text-sm text-hint">Сейчас отклонённых нет.</p> : (
          <div className="divide-y divide-line">
            {v.rejected.map((r) => (
              <div key={r.ad_id} className="py-2.5">
                <div className="flex flex-wrap gap-2 items-start">
                  <div className="flex-1 min-w-[220px]">
                    <p className="text-sm text-zinc-200 truncate">{r.ad_name ?? r.ad_id}</p>
                    <p className="text-[11px] text-hint truncate">{r.campaign_name ?? "—"} · CAB{r.account_id.slice(-4)} · с {when(r.first_seen_at)}</p>
                    {r.reason && <p className="text-[11px] text-red-300/90 mt-0.5 line-clamp-2">{r.reason}</p>}
                  </div>
                  {!r.ad_id.startsWith("tg:") && (
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(KIND) as Kind[]).map((k) => (
                        <button key={k} type="button" onClick={() => open(r.ad_id, k)} className={`${small} ${panel?.adId === r.ad_id && panel.kind === k ? "border-violet-500 text-white" : "border-line text-zinc-300"}`}>{KIND[k]}</button>
                      ))}
                      <button type="button" onClick={() => uniq(r.ad_id)} className={`${small} border-line text-zinc-300`}>🎬 Уникализация</button>
                      <a href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${r.account_id}&selected_ad_ids=${r.ad_id}`} target="_blank" rel="noreferrer" className={`${small} border-line text-hint`}>Ads Manager ↗</a>
                    </div>
                  )}
                </div>
                {panel?.adId === r.ad_id && (
                  <div className="mt-2 ml-1 border-l-2 border-violet-700/50 pl-3 space-y-2">
                    <p className="text-xs text-zinc-400">{KIND[panel.kind]}{panel.now ? ` · сейчас: ${panel.now}` : ""}</p>
                    {panel.loading && <p className="text-xs text-hint">Секунду…</p>}
                    {panel.error && <p className="text-xs text-red-300">{panel.error}</p>}
                    {panel.done && <p className="text-xs text-green-300">{panel.done}</p>}
                    {!panel.confirm && !panel.done && panel.reason && <p className="text-xs text-amber-300">{panel.reason}</p>}
                    {!panel.confirm && !panel.done && (
                      <div className="flex flex-wrap gap-1.5">
                        {(panel.choices ?? []).map((c) => (
                          <button key={c.value} type="button" disabled={panel.loading} onClick={() => choose(c.value)} className={`${small} border-line text-zinc-200 text-xs`}>{c.label}</button>
                        ))}
                      </div>
                    )}
                    {panel.confirm && (
                      <div className="space-y-2">
                        <p className="text-xs text-zinc-200 break-all">{panel.confirm.describe}</p>
                        <p className="text-[11px] text-hint">Объявление уйдёт на повторную проверку Meta.</p>
                        <div className="flex gap-2">
                          <button type="button" disabled={panel.loading} onClick={confirm} className={`${small} border-green-700/50 text-green-300`}>✅ Подтвердить и отправить в Meta</button>
                          <button type="button" onClick={() => setPanel(null)} className={`${small} border-line text-zinc-400`}>Отмена</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div data-tour="ar-history" className={card}>
        <h2 className="text-base font-semibold text-white mb-3">История антиотклона</h2>
        {v.events.length === 0 ? <p className="text-sm text-hint">Событий пока нет — новые отклонения и действия появятся здесь.</p> : (
          <div className="divide-y divide-line">
            {v.events.map((e) => (
              <div key={e.id} className="py-2 text-sm">
                <p className="text-zinc-200">
                  <span className={e.kind === "rejected" ? "text-red-300" : e.ok ? "text-green-300" : "text-amber-300"}>
                    {e.kind === "rejected" ? "⛔ Отклонено" : e.ok ? "✅ Изменено" : "⚠️ Не вышло"}
                  </span>{" "}
                  · {e.ad_name ?? e.ad_id} <span className="text-hint">· {when(e.created_at)}{e.actor ? ` · ${e.actor}` : ""}{e.status ? ` · ${e.status}` : ""}</span>
                </p>
                {e.text && <p className="text-[11px] text-hint break-all">{e.text}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <h2 className="text-base font-semibold text-white mb-1">Лендинги Torro</h2>
        <p className="text-[11px] text-hint mb-3">При замене ссылки предлагаются лендинги той же воронки на другом домене, 10 самых новых.</p>
        {v.landings.length === 0 ? <p className="text-sm text-hint">Torro не подключён или лендингов нет.</p> : (
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            {v.landings.map((l) => (
              <p key={l.id} className="text-sm text-zinc-300 truncate">{l.name} <span className="text-[11px] text-hint">· {l.series ? SERIES[l.series] : "—"} · {l.url.replace(/^https?:\/\//, "").split("/")[0]}</span></p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
