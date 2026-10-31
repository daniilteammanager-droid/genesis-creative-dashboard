"use client";

import { useEffect, useState } from "react";
import type { MetaKeyView } from "@/lib/connections/metaKeys";

// Источник расхода — ровно один (Decision 061): Meta (ключей сколько угодно,
// все работают одновременно), Dolphin Cloud (Decision 063) или FB Tool (Decision 071).
// Это источник Facebook; Telegram Ads — своей карточкой рядом (Decision 069).

const field =
  "w-full bg-panel border border-line rounded-xl px-4 py-3 outline-none " +
  "focus:border-violet-600/50 transition placeholder:text-hint text-white text-sm";
const card = "bg-card border border-line rounded-2xl p-6";
const pill = "text-[11px] px-2.5 py-1 rounded-full border transition disabled:opacity-50";

interface State { keys: MetaKeyView[]; source: string | null; backfilledFrom: string | null; backfillDone: boolean; dolphinHint: string | null; fbtoolHint: string | null }
type FbtoolAccount = { id: string; name: string; ok: boolean; problem: string | null };

const SOURCES = [
  { id: "meta", label: "Meta API", ready: true },
  { id: "fbtool", label: "FB Tool", ready: true },
  { id: "dolphin", label: "Dolphin Cloud", ready: true },
];
type Source = "meta" | "dolphin" | "fbtool";

const date = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function MetaKeys() {
  const [state, setState] = useState<State | null>(null);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  // Какой источник смотрим, пока ни один не подключён. Подключён — только он.
  const [pick, setPick] = useState<Source>("meta");
  const [dolphinToken, setDolphinToken] = useState("");
  const [fbtoolKey, setFbtoolKey] = useState("");
  const [fbAccounts, setFbAccounts] = useState<FbtoolAccount[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/meta-keys")
      .then((r) => r.json() as Promise<State & { error?: string }>)
      .then((d) => { if (d.error) throw new Error(d.error); setState(d); })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, []);

  async function call(init: RequestInit, url = "/api/meta-keys", ok = "Готово") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, init);
      // Ответ не всегда JSON: упавшая функция отдаёт HTML.
      const d = (await res.json().catch(() => null)) as (State & { error?: string }) | null;
      if (!res.ok || !d) throw new Error(d?.error ?? "Не получилось — попробуй ещё раз");
      setState(d);
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
    const done = await call(
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, token }) },
      "/api/meta-keys", "Ключ проверен и добавлен. Кабинеты и сегодняшний расход подтянутся в течение пары минут, история догрузится сама",
    );
    if (done) { setName(""); setToken(""); }
  }

  const keys = state?.keys ?? [];
  const readOnly = keys.filter((k) => !k.canWrite).length;
  const shown = (state?.source as Source | null) ?? pick;

  // После Dolphin перечитываем общий вид: источник и прогресс догрузки.
  async function reload() {
    const d = await fetch("/api/meta-keys").then((r) => r.json()).catch(() => null);
    if (d && !d.error) setState(d);
  }

  async function connectDolphin(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/dolphin", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: dolphinToken }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) { setMsg({ ok: false, text: d?.error ?? "Не получилось — попробуй ещё раз" }); return; }
    setDolphinToken("");
    setMsg({ ok: true, text: `Dolphin подключён (${d.account}). Кабинеты и сегодняшний расход подтянутся в течение пары минут, история догрузится сама` });
    reload();
  }

  // Аккаунты FB Tool — отдельным запросом: FB Tool отвечает не мгновенно.
  useEffect(() => {
    if (state?.source !== "fbtool") return;
    fetch("/api/fbtool").then((r) => r.json()).then((d) => setFbAccounts(d.accounts ?? null)).catch(() => undefined);
  }, [state?.source]);

  async function connectFbtool(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/fbtool", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: fbtoolKey }),
    }).catch(() => null);
    const d = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) { setMsg({ ok: false, text: d?.error ?? "Не получилось — попробуй ещё раз" }); return; }
    setFbtoolKey("");
    setFbAccounts(d.accounts ?? null);
    const live = (d.accounts ?? []).filter((a: FbtoolAccount) => a.ok).length;
    setMsg({ ok: true, text: `FB Tool подключён: живых аккаунтов ${live} из ${(d.accounts ?? []).length}. Кабинеты и сегодняшний расход подтянутся в течение пары минут` });
    reload();
  }

  async function disconnectFbtool() {
    await fetch("/api/fbtool", { method: "DELETE" });
    setConfirm(null);
    setFbAccounts(null);
    setMsg({ ok: true, text: "FB Tool отключён. История в дашборде осталась" });
    reload();
  }

  async function disconnectDolphin() {
    await fetch("/api/dolphin", { method: "DELETE" });
    setConfirm(null);
    setMsg({ ok: true, text: "Dolphin отключён. История в дашборде осталась" });
    reload();
  }

  return (
    <div className={card}>
      <h2 className="text-lg font-semibold text-white mb-2">Источник расхода Facebook</h2>
      <p className="text-sm text-zinc-400 leading-relaxed mb-3">
        Откуда берутся расход, показы и клики. Подключается один источник; чтобы перейти на другой,
        сначала удали текущий. История в дашборде при этом не теряется.
      </p>
      <div className="flex gap-1.5 flex-wrap mb-5">
        {SOURCES.map((s) => (
          <button key={s.id} type="button"
                  disabled={!s.ready || Boolean(state?.source && state.source !== s.id)}
                  onClick={() => setPick(s.id as Source)}
                  className={`text-[12px] px-3 py-1.5 rounded-lg border transition disabled:cursor-not-allowed ${
            shown === s.id
              ? "border-violet-600/50 text-violet-200 bg-violet-900/20"
              : "border-line text-hint hover:text-zinc-400"}`}>
            {s.label}{!s.ready && " · скоро"}
          </button>
        ))}
      </div>

      {shown === "fbtool" && (
        <div className="mb-2">
          {state?.fbtoolHint !== null && state?.fbtoolHint !== undefined ? (
            <>
              <div className="flex items-center gap-3 flex-wrap mb-3">
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-green-900/30 text-green-400 border border-green-800/30">
                  подключено {state.fbtoolHint}
                </span>
                <button type="button" disabled={busy}
                        onClick={() => confirm === "fbtool" ? disconnectFbtool() : setConfirm("fbtool")}
                        className={`${pill} border-red-800/40 text-red-300 hover:bg-red-900/20`}>
                  {confirm === "fbtool" ? "точно отключить?" : "отключить"}
                </button>
              </div>
              {fbAccounts && (
                <div className="divide-y divide-line border border-line rounded-xl mb-3">
                  {fbAccounts.map((a) => (
                    <div key={a.id} className="px-4 py-2.5 flex items-start gap-3">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${a.ok ? "bg-green-500" : "bg-red-500"}`} />
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-200 truncate">{a.name}</p>
                        {!a.ok && <p className="text-[11px] text-red-300/90 mt-0.5">Разлогинен в FB Tool — данных по нему нет. {a.problem}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <form onSubmit={connectFbtool} className="space-y-2.5">
              <input type="password" placeholder="Ключ API FB Tool" value={fbtoolKey} autoComplete="off"
                     onChange={(e) => setFbtoolKey(e.target.value)} className={field} />
              <button type="submit" disabled={busy || !fbtoolKey.trim()}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50">
                {busy ? "Проверяю…" : "Подключить FB Tool"}
              </button>
            </form>
          )}
          <p className="text-[11px] text-hint leading-relaxed mt-2">
            Ключ — в FB Tool, раздел API. Статистика идёт из FB Tool вживую, через твои аккаунты в нём: разлогиненный
            аккаунт данных не отдаёт, пока его не перелогинишь в FB Tool. В Facebook напрямую дашборд не ходит.
            Страна — из нейминга адсета или РК.
          </p>
        </div>
      )}

      {shown === "dolphin" && (
        <div className="mb-2">
          {state?.dolphinHint !== null && state?.dolphinHint !== undefined ? (
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-green-900/30 text-green-400 border border-green-800/30">
                подключено {state.dolphinHint}
              </span>
              <button type="button" disabled={busy}
                      onClick={() => confirm === "dolphin" ? disconnectDolphin() : setConfirm("dolphin")}
                      className={`${pill} border-red-800/40 text-red-300 hover:bg-red-900/20`}>
                {confirm === "dolphin" ? "точно отключить?" : "отключить"}
              </button>
            </div>
          ) : (
            <form onSubmit={connectDolphin} className="space-y-2.5">
              <input type="password" placeholder="Ключ API Dolphin Cloud" value={dolphinToken} autoComplete="off"
                     onChange={(e) => setDolphinToken(e.target.value)} className={field} />
              <button type="submit" disabled={busy || !dolphinToken.trim()}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50">
                Подключить Dolphin
              </button>
            </form>
          )}
          <p className="text-[11px] text-hint leading-relaxed mt-2">
            Расход, показы и клики — из статистики самого Dolphin. В Facebook дашборд от имени аккаунтов не ходит:
            у них свои прокси. Страна берётся из нейминга адсета или РК — Dolphin таргет не отдаёт.
          </p>
        </div>
      )}

      {shown === "meta" && keys.length > 0 && (
        <div className="divide-y divide-line border border-line rounded-xl mb-4">
          {keys.map((k) => (
            <div key={k.id} className="px-4 py-3 flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <p className="text-sm text-zinc-200">{k.name} <span className="text-hint">{k.hint}</span></p>
                <p className="text-[11px] text-hint mt-0.5">
                  {k.appId && `приложение ${k.appId} · `}
                  {k.expiresAt ? `действует до ${date(k.expiresAt)}` : "бессрочный"}
                  {k.lastOkAt && ` · работал ${date(k.lastOkAt)}`}
                </p>
                {k.lastError && <p className="text-[11px] text-red-300 mt-1">Последняя ошибка: {k.lastError}</p>}
              </div>
              <span className={`text-[11px] px-2.5 py-1 rounded-full border ${k.canWrite
                ? "bg-green-900/30 text-green-400 border-green-800/30"
                : "bg-amber-900/20 text-amber-300 border-amber-800/30"}`}>
                {k.canWrite ? "чтение и изменения" : "только чтение"}
              </span>
              <button type="button" disabled={busy}
                      onClick={() => confirm === k.id
                        ? call({ method: "DELETE" }, `/api/meta-keys?id=${k.id}`, "Ключ удалён").then(() => setConfirm(null))
                        : setConfirm(k.id)}
                      className={`${pill} border-red-800/40 text-red-300 hover:bg-red-900/20`}>
                {confirm === k.id ? "точно удалить?" : "удалить"}
              </button>
            </div>
          ))}
        </div>
      )}

      {shown === "meta" && readOnly > 0 && (
        <p className="text-[12px] text-amber-300/90 leading-relaxed mb-4">
          {readOnly === keys.length ? "У ключа" : `У ${readOnly} из ${keys.length} ключей`} нет права <code>ads_management</code>.
          Статистика работает, но кнопки антиотклона и Live Manager не смогут менять объявления в этих кабинетах.
          Выпусти ключ заново с этим правом.
        </p>
      )}

      {state?.source && (
        <p className="text-[12px] text-hint mb-4">
          История: {state.backfillDone ? "загружена полностью" : state.backfilledFrom
            ? `загружена с ${date(state.backfilledFrom)}, догружается дальше`
            : "начнёт догружаться в ближайшие 15 минут"}.
        </p>
      )}

      {shown === "meta" && <>
      <form onSubmit={add} className="space-y-2.5">
        <input type="text" placeholder="Название, например «APP 27 — БМ Испания»" value={name}
               onChange={(e) => setName(e.target.value)} className={field} />
        <input type="password" placeholder="Токен доступа Meta" value={token} autoComplete="off"
               onChange={(e) => setToken(e.target.value)} className={field} />
        <button type="submit" disabled={busy || !token.trim()}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50">
          {busy ? "Проверяю…" : keys.length ? "Добавить ещё ключ" : "Подключить Meta"}
        </button>
      </form>
      <p className="text-[11px] text-hint leading-relaxed mt-2">
        Нужны права <code>ads_read</code> и <code>ads_management</code>. Ключ проверяется при добавлении и обратно
        не читается. Кабинеты, которые он видит, сами закрепятся за тобой.
      </p>
      </>}

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm border mt-3 ${
          msg.ok ? "bg-green-950/30 border-green-700/30 text-green-300" : "bg-red-950/40 border-red-700/30 text-red-300"
        }`}>{msg.text}</div>
      )}
    </div>
  );
}
