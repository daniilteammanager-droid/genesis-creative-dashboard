"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui";

// Настройки → AI-доступ (Decision 116): адрес MCP-сервера, как подключить Claude, Claude Code и
// Codex, свои подключения и ключ для терминала. Логика — в lib/mcp/store.ts, здесь только экран.

type Connection = { id: string; name: string; personal: boolean; createdAt: string; lastUsedAt: string | null };

const when = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Copy({ text, label = "Копировать" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      {done ? <><Icon name="check" className="w-3.5 h-3.5" /> Скопировано</> : label}
    </button>
  );
}

function Cmd({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="flex-1 block bg-panel border border-line rounded-lg px-3 py-2 text-xs break-all text-zinc-200">{text}</code>
      <Copy text={text} />
    </div>
  );
}

export default function AiAccess({ url }: { url: string }) {
  const [list, setList] = useState<Connection[] | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/mcp-tokens").then((r) => r.json()).then((d) => (d.error ? setErr(d.error) : setList(d.connections))).catch(() => setErr("Не загрузилось"));
  }, []);
  useEffect(load, [load]);

  const revoke = async (id: string) => {
    const r = await fetch(`/api/mcp-tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then((x) => x.json());
    if (r.error) setErr(r.error); else load();
  };
  const createKey = async () => {
    const r = await fetch("/api/mcp-tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Ключ для терминала" }) }).then((x) => x.json());
    if (r.error) setErr(r.error); else { setKey(r.key); load(); }
  };

  return (
    <div className="space-y-4">
      <section className="card p-6 space-y-3">
        <h2 className="text-lg font-semibold">Свой Claude или Codex в дашборде</h2>
        <p className="text-sm text-zinc-300">
          AI читает статистику, кампании и кабинеты, цифры и расшифровки крео, AI-разборы и чеки — ровно то, что ты видишь здесь.
          Ставит на паузу, запускает и меняет дневной бюджет твоих кампаний, как Live Manager, — спросив тебя. Ведёт твои задачи
          и холсты. Видит заявки на пополнение, собирает по ним сводку и создаёт новые — спросив тебя, как форма в «Пополнениях». Вход — твоим аккаунтом дашборда.
        </p>
        <div>
          <div className="label mb-1">Адрес сервера</div>
          <Cmd text={url} />
        </div>
      </section>

      <section className="card p-6 space-y-4">
        <div>
          <h3 className="font-medium mb-1">Claude — сайт, приложение, телефон</h3>
          <p className="text-sm text-zinc-300">
            Settings → Connectors → <b>Add custom connector</b>, вставь адрес сервера, нажми Connect — откроется дашборд: войди и нажми «Разрешить».
          </p>
        </div>
        <div className="space-y-1.5">
          <h3 className="font-medium">Claude Code</h3>
          <Cmd text={`claude mcp add --transport http genesis ${url}`} />
          <p className="text-xs text-hint">Потом в Claude Code — <code>/mcp</code> → genesis → войти.</p>
        </div>
        <div className="space-y-1.5">
          <h3 className="font-medium">Codex</h3>
          <Cmd text={`codex mcp add genesis --url ${url}`} />
          <Cmd text="codex mcp login genesis" />
        </div>
      </section>

      <section className="card p-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">Ключ для терминала</h3>
            <p className="text-xs text-hint">Если вход через браузер не подходит (сервер, скрипт). Ключ показывается один раз.</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={createKey}><Icon name="lock" className="w-3.5 h-3.5" /> Создать ключ</button>
        </div>
        {key && (
          <div className="space-y-1.5">
            <Cmd text={key} />
            <p className="text-xs text-hint">Claude Code:</p>
            <Cmd text={`claude mcp add --transport http genesis ${url} --header "Authorization: Bearer ${key}"`} />
            <p className="text-xs text-hint">Codex — ключ в переменной окружения GENESIS_KEY:</p>
            <Cmd text={`codex mcp add genesis --url ${url} --bearer-token-env-var GENESIS_KEY`} />
          </div>
        )}
      </section>

      <section className="card p-6">
        <h3 className="font-medium mb-3">Подключения</h3>
        {err && <p className="text-sm text-red-300 mb-2">{err}</p>}
        {list === null ? <p className="text-sm text-hint">Загружаю…</p>
          : list.length === 0 ? <p className="text-sm text-hint">Пока ничего не подключено.</p>
          : (
            <ul className="divide-y divide-line">
              {list.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm truncate">{c.name}</div>
                    <div className="text-xs text-hint">
                      с {when(c.createdAt)} · {c.lastUsedAt ? `последний вызов ${when(c.lastUsedAt)}` : "вызовов ещё не было"}
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => revoke(c.id)}>Отключить</button>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
