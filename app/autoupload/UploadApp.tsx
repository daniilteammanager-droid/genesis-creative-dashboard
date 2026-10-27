"use client";

import { useCallback, useEffect, useState } from "react";

// Приложение Meta для автозалива (Decision 093): своё, отдельно от ключей статистики в
// «Интеграциях». Ключ с ads_management и, если приложение требует, App Secret.

const card = "bg-[#111118] border border-violet-900/30 rounded-2xl p-5";
const field = "bg-[#0d0b14] border border-violet-900/40 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-600/50 text-white";
const small = "px-3 py-1.5 rounded-lg text-sm border transition disabled:opacity-50";

interface Key { name: string; hint: string | null; appId: string | null; appName: string | null; canWrite: boolean; expiresAt: string | null; lastError: string | null; hasSecret: boolean }
interface Usage { calls: number; cpu: number; time: number; regainMin: number; tier: string | null; appPct: number | null }
const tone = (v: number) => (v >= 80 ? "text-red-300" : v >= 50 ? "text-amber-300" : "text-green-300");

const post = (body: Record<string, unknown>) =>
  fetch("/api/autoupload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok || d.error) throw new Error(d.error ?? "Не получилось"); return d; });

export default function UploadApp() {
  const [key, setKey] = useState<Key | null | undefined>(undefined);
  const [fallback, setFallback] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ name: "", token: "", secret: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const load = useCallback(() => fetch("/api/autoupload?op=key").then((r) => r.json()).then((d) => { setKey(d.key ?? null); setFallback(d.fallback ?? null); }).catch(() => setKey(null)), []);
  useEffect(() => { load(); }, [load]);

  async function run(f: () => Promise<void>) {
    setBusy(true); setNote(null);
    try { await f(); } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  }
  const save = () => run(async () => { await post({ op: "setKey", ...form }); setEdit(false); setForm({ name: "", token: "", secret: "" }); await load(); setNote("Подключено — автозалив теперь идёт этим приложением"); });
  const remove = () => window.confirm("Отключить приложение автозалива? Заливать будет ключ статистики с ads_management.") && run(async () => { await post({ op: "deleteKey" }); setUsage(null); await load(); });
  const check = () => run(async () => { const d = await post({ op: "checkKey" }); setUsage(d.usage); await load(); });

  if (key === undefined) return null;
  return (
    <div data-tour="au-app" className={card}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="text-base font-semibold text-white">Приложение Meta для автозалива</h2>
        {key && !edit && (
          <div className="ml-auto flex gap-2">
            <button type="button" disabled={busy} onClick={check} className={`${small} border-violet-700/50 text-violet-200`}>Проверить и лимит</button>
            <button type="button" onClick={() => setEdit(true)} className={`${small} border-violet-900/40 text-zinc-300`}>Заменить</button>
            <button type="button" disabled={busy} onClick={remove} className={`${small} border-red-900/40 text-red-300`}>Отключить</button>
          </div>
        )}
      </div>
      {key && !edit ? (
        <div className="text-sm space-y-1">
          <p className="text-zinc-200">{key.name} · {key.appName ?? "приложение"}{key.appId ? ` · App ID ${key.appId}` : ""} · ключ …{key.hint}{key.hasSecret ? " · с App Secret" : ""}</p>
          <p className="text-[11px] text-zinc-500">
            {key.canWrite ? "Право ads_management есть." : "Нет права ads_management — заливать нельзя."}
            {key.expiresAt ? ` Ключ до ${new Date(key.expiresAt).toLocaleDateString("ru-RU")}.` : " Ключ бессрочный."}
            {" "}Статистика, алерты и Live Manager идут ключами из «Интеграций», этим — только залив.
          </p>
          {key.lastError && <p className="text-[11px] text-red-300">{key.lastError}</p>}
          {usage && (
            <div className="text-[11px] text-zinc-400 space-y-0.5">
              <p>Часовой лимит Marketing API (самый загруженный бизнес или кабинет): вызовы <b className={tone(usage.calls)}>{usage.calls}%</b> · CPU <b className={tone(usage.cpu)}>{usage.cpu}%</b> · время <b className={tone(usage.time)}>{usage.time}%</b>
                {usage.regainMin > 0 && <> · <b className="text-red-300">доступ вернётся через {usage.regainMin} мин</b></>}</p>
              <p>Общий лимит приложения на статистику: {usage.appPct === null ? "—" : <b className={tone(usage.appPct)}>{usage.appPct}%</b>}
                {usage.tier && <> · уровень доступа: <b className={usage.tier === "standard_access" ? "text-green-300" : "text-amber-300"}>{usage.tier === "standard_access" ? "Standard" : "Development"}</b>
                  {usage.tier !== "standard_access" && " — лимиты низкие, для больших заливов нужен Standard Access в настройках приложения"}</>}</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="text-[11px] text-zinc-500 mb-2">
            {key ? "Новый ключ заменит текущий." : fallback
              ? `Сейчас заливает ключ статистики «${fallback}» — он делит лимит со складом и алертами. Подключи отдельное приложение, как у Артёма.`
              : "Своего приложения нет, и у ключей статистики нет права ads_management — заливать нечем."}
            {" "}Нужен ключ с ads_management, у которого есть доступ к БМ твоих кабинетов.
          </p>
          <div className="grid sm:grid-cols-3 gap-2">
            <input placeholder="Название (необязательно)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
            <input placeholder="Access Token" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} className={`${field} font-mono`} />
            <input placeholder="App Secret (если требует приложение)" type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} className={`${field} font-mono`} />
          </div>
          <div className="flex gap-2 mt-2">
            <button type="button" disabled={busy || !form.token.trim()} onClick={save} className={`${small} border-violet-700/50 text-violet-200`}>{busy ? "Проверяю…" : "Проверить и подключить"}</button>
            {key && <button type="button" onClick={() => setEdit(false)} className={`${small} border-violet-900/40 text-zinc-400`}>Отмена</button>}
          </div>
        </>
      )}
      {note && <p className="text-xs text-violet-200 mt-2">{note}</p>}
    </div>
  );
}
