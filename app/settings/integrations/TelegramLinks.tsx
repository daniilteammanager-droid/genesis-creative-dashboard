"use client";

import { useCallback, useEffect, useState } from "react";
import type { TelegramEvent } from "@/lib/telegram/events";
import type { TelegramLink } from "@/lib/telegram/links";

const card = "bg-[#111118] border border-violet-900/30 rounded-2xl p-6";
const pill = "text-[11px] px-2.5 py-1 rounded-full border transition disabled:opacity-50";
const button =
  "px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white " +
  "shadow-sm hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50";

interface State { bot: string | null; events: TelegramEvent[]; links: TelegramLink[] }
interface Invite { privateUrl: string; groupUrl: string; command: string }

const GROUP_LABELS: Record<TelegramLink["checkGroup"], string> = {
  campaign: "по кампаниям", creative: "по креативам", country: "по странам",
};

// Время авточека — строкой, как его и говорят: «10:00, 14:00, 18:00».
// Проверяет сервер: кратность 15 минутам там же, где и сам прогон.
function Schedule({ link, busy, save }: {
  link: TelegramLink; busy: boolean; save: (times: string, group: TelegramLink["checkGroup"]) => void;
}) {
  const [times, setTimes] = useState(link.checkTimes.join(", "));
  const [group, setGroup] = useState(link.checkGroup);
  const changed = times !== link.checkTimes.join(", ") || group !== link.checkGroup;
  const input = "bg-[#0d0b14] border border-violet-900/40 rounded-lg px-3 py-1.5 outline-none focus:border-violet-600/50 text-white text-[12px]";
  return (
    <div className="flex items-center gap-2 flex-wrap mt-2.5">
      <span className="text-[12px] text-zinc-500">Чек в</span>
      <input type="text" value={times} onChange={(e) => setTimes(e.target.value)}
             placeholder="10:00, 18:00" className={`${input} w-40`} />
      <select value={group} onChange={(e) => setGroup(e.target.value as TelegramLink["checkGroup"])}
              className={`${input} cursor-pointer`}>
        {(Object.keys(GROUP_LABELS) as TelegramLink["checkGroup"][]).map((g) => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
      </select>
      <button type="button" disabled={busy || !changed} onClick={() => save(times, group)}
              className={`${pill} border-violet-800/40 text-violet-300 hover:bg-violet-900/20`}>
        сохранить
      </button>
      <span className="text-[11px] text-zinc-600">по Москве, шаг 15 минут</span>
    </div>
  );
}

function placeLabel(l: TelegramLink): string {
  if (l.chatType === "private") return "личный чат";
  return l.threadId ? "тема в группе" : "группа";
}

export default function TelegramLinks() {
  const [state, setState] = useState<State | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Ответ не всегда JSON: упавшая функция отдаёт HTML.
  const call = useCallback(async (url: string, init?: RequestInit) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Не получилось — попробуй ещё раз");
      return data;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Сеть не ответила" });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const load = useCallback(async () => {
    const data = await call("/api/telegram/links");
    if (data) setState(data);
  }, [call]);

  // Первая загрузка без busy: состояние меняется только в колбэке ответа.
  useEffect(() => {
    fetch("/api/telegram/links")
      .then((r) => r.json() as Promise<State & { error?: string }>)
      .then((d) => { if (d.error) throw new Error(d.error); setState(d); })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, []);

  const json = (method: string, body: unknown): RequestInit =>
    ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function newInvite() {
    const data = await call("/api/telegram/links", json("POST", { action: "code" }));
    if (data) setInvite(data);
  }

  async function toggle(link: TelegramLink, key: string) {
    const events = link.events.includes(key) ? link.events.filter((k) => k !== key) : [...link.events, key];
    const data = await call("/api/telegram/links", json("PATCH", { id: link.id, events }));
    if (data && state) setState({ ...state, links: data.links });
  }

  async function unlink(id: string) {
    const data = await call(`/api/telegram/links?id=${id}`, { method: "DELETE" });
    if (data && state) setState({ ...state, links: data.links });
  }

  async function test(id: string) {
    const data = await call("/api/telegram/links", json("POST", { action: "test", id }));
    if (data) setMsg({ ok: true, text: "Отправлено — проверь чат" });
    else load();   // привязку могли снять как мёртвую
  }

  return (
    <div className={card}>
      <h2 className="text-lg font-semibold text-white mb-2">Telegram</h2>
      <p className="text-sm text-zinc-400 leading-relaxed mb-4">
        Бот команды присылает уведомления в личку, в группу или в тему группы. Привязок
        может быть сколько угодно, и в каждой свой набор уведомлений.
      </p>

      {state && !state.bot && (
        <p className="text-[13px] text-zinc-500 leading-relaxed">
          Бот ещё не подключён к дашборду — владелец задаёт его ключ в настройках сервера.
        </p>
      )}

      {state?.bot && (
        <>
          {state.links.length > 0 && (
            <div className="divide-y divide-violet-900/20 border border-violet-900/25 rounded-xl mb-4">
              {state.links.map((l) => (
                <div key={l.id} className="px-4 py-3">
                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <span className="text-sm text-zinc-200 flex-1 min-w-[120px]">{l.title ?? "без названия"}</span>
                    <span className="text-[11px] text-zinc-600">{placeLabel(l)}</span>
                    <button type="button" disabled={busy} onClick={() => test(l.id)}
                            className={`${pill} border-violet-800/40 text-violet-300 hover:bg-violet-900/20`}>
                      проверить
                    </button>
                    <button type="button" disabled={busy} onClick={() => unlink(l.id)}
                            className={`${pill} border-red-800/40 text-red-300 hover:bg-red-900/20`}>
                      отвязать
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {state.events.map((e) => (
                      <label key={e.key} title={e.hint} className="flex items-center gap-1.5 text-[12px] text-zinc-400 cursor-pointer">
                        <input type="checkbox" disabled={busy} checked={l.events.includes(e.key)}
                               onChange={() => toggle(l, e.key)} className="accent-violet-500" />
                        {e.label}
                        {!e.ready && <span className="text-[10px] text-zinc-600">скоро</span>}
                      </label>
                    ))}
                  </div>
                  {l.events.includes("autocheck") && (
                    <Schedule link={l} busy={busy}
                              save={async (checkTimes, checkGroup) => {
                                const data = await call("/api/telegram/links", json("PATCH", { id: l.id, checkTimes, checkGroup }));
                                if (data && state) { setState({ ...state, links: data.links }); setMsg({ ok: true, text: "Расписание сохранено" }); }
                              }} />
                  )}
                </div>
              ))}
            </div>
          )}

          {!invite ? (
            <button type="button" disabled={busy} onClick={newInvite} className={button}>
              Привязать Telegram
            </button>
          ) : (
            <div className="space-y-2 text-[13px] text-zinc-400 leading-relaxed">
              <p>Ссылка действует 15 минут и срабатывает один раз. Выбери, куда:</p>
              <div className="flex gap-2 flex-wrap">
                <a href={invite.privateUrl} target="_blank" rel="noreferrer" className={button}>В личку</a>
                <a href={invite.groupUrl} target="_blank" rel="noreferrer" className={button}>В группу</a>
              </div>
              <p className="text-[12px] text-zinc-600">
                В тему группы: добавь бота в группу и отправь в нужной теме{" "}
                <code className="text-zinc-400">{invite.command}</code>
              </p>
              <button type="button" disabled={busy} onClick={() => { setInvite(null); load(); }}
                      className={`${pill} border-violet-800/40 text-violet-300 hover:bg-violet-900/20`}>
                готово, обновить список
              </button>
            </div>
          )}
        </>
      )}

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm border mt-3 ${
          msg.ok ? "bg-green-950/30 border-green-700/30 text-green-300"
                 : "bg-red-950/40 border-red-700/30 text-red-300"
        }`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
