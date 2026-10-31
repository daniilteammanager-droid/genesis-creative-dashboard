"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/client";
import { ROLE_LABELS, type Profile } from "@/lib/auth/types";
import { WORK_AREAS, startPageOf } from "@/lib/nav";


const card = "card p-6";


export default function ProfileSettings({ profile }: { profile: Profile }) {
  const router = useRouter();

  const [name, setName] = useState(profile.name ?? "");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const [current, setCurrent] = useState("");
  const [next1, setNext1] = useState("");
  const [next2, setNext2] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameBusy(true);
    setNameMsg(null);
    // Из всех колонок профиля правится только name — остальные закрыты грантами
    // Postgres, а не RLS (Decision 030).
    const { error } = await createClient()
      .from("profiles")
      .update({ name: name.trim() || null })
      .eq("id", profile.id);
    setNameBusy(false);
    setNameMsg(error ? error.message : "Сохранено");
    // Имя показано в левой панели — её рисует серверный layout, просим перечитать.
    if (!error) router.refresh();
  }

  const [start, setStart] = useState(startPageOf(profile.start_page));
  const [startMsg, setStartMsg] = useState<string | null>(null);
  async function saveStart(href: string) {
    setStart(href);
    const { error } = await createClient().from("profiles").update({ start_page: href }).eq("id", profile.id);
    setStartMsg(error ? error.message : "Сохранено");
  }

  // Сброс отметки — оболочка увидит пустой onboarded_at и откроет обучалку (Decision 078).
  async function restartTour() {
    await createClient().from("profiles").update({ onboarded_at: null }).eq("id", profile.id);
    router.refresh();
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg(null);

    if (next1 !== next2) {
      setPwdMsg({ ok: false, text: "Новые пароли не совпадают" });
      return;
    }

    setPwdBusy(true);
    const supabase = createClient();

    // Supabase меняет пароль по действующей сессии и текущий пароль не спрашивает.
    // Спрашиваем сами: иначе любой, кто дорвался до незакрытой вкладки, меняет
    // пароль в два клика и запирает владельца снаружи.
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: current,
    });
    if (authError) {
      setPwdBusy(false);
      // Не всякий отказ здесь — неверный пароль: сюда же приходят обрыв сети и
      // лимит попыток. Выдавать их за «пароль неверный» значит отправить человека
      // искать не там.
      setPwdMsg({
        ok: false,
        text: authError.message === "Invalid login credentials"
          ? "Текущий пароль неверный"
          : authError.message,
      });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: next1 });
    setPwdBusy(false);

    if (error) {
      setPwdMsg({ ok: false, text: error.message });
      return;
    }
    setPwdMsg({ ok: true, text: "Пароль изменён" });
    setCurrent("");
    setNext1("");
    setNext2("");
  }

  async function signOut() {
    await createClient().auth.signOut();
    // Полная перезагрузка, чтобы middleware увидел, что cookie больше нет.
    window.location.assign("/login");
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="text-lg font-semibold text-white mb-4">Аккаунт</h2>

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm mb-5">
          <dt className="text-hint">Почта</dt>
          <dd className="text-zinc-300">{profile.email}</dd>
          <dt className="text-hint">Роль</dt>
          <dd className="text-zinc-300">{ROLE_LABELS[profile.role]}</dd>
          {profile.buyer_code && (
            <>
              <dt className="text-hint">Код баера</dt>
              <dd className="text-zinc-300">{profile.buyer_code}</dd>
            </>
          )}
        </dl>

        <form onSubmit={saveName} className="flex gap-2 items-start flex-wrap">
          <input
            type="text"
            placeholder="Имя"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameMsg(null); }}
            className={`field w-full flex-1 min-w-[200px]`}
          />
          <button type="submit" disabled={nameBusy} className="btn btn-primary">
            {nameBusy ? "Секунду…" : "Сохранить"}
          </button>
        </form>
        {nameMsg && <p className="text-xs text-hint mt-2">{nameMsg}</p>}

        <p className="text-[11px] text-hint leading-relaxed mt-4">
          {/* Баеру незачем читать про вкладку, которой он не видит. */}
          {profile.role === "main"
            ? "Почту, роль и код баера меняет только владелец — на вкладке «Команда»."
            : "Имя правишь сам. Почта, роль и код баера — только через владельца."}
        </p>
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-white mb-2">Стартовая страница</h2>
        <p className="text-sm text-hint mb-4">Что открывается при входе в дашборд.</p>
        <select value={start} onChange={(e) => saveStart(e.target.value)} className="field w-full">
          {WORK_AREAS.map((a) => <option key={a.href} value={a.href}>{a.label}</option>)}
        </select>
        {startMsg && <p className="text-xs text-hint mt-2">{startMsg}</p>}
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-white mb-4">Пароль</h2>

        <form onSubmit={changePassword} className="space-y-3">
          <input
            type="password"
            placeholder="Текущий пароль"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            autoComplete="current-password"
            className="field w-full"
          />
          <input
            type="password"
            placeholder="Новый пароль"
            value={next1}
            onChange={(e) => setNext1(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className="field w-full"
          />
          <input
            type="password"
            placeholder="Повтори новый пароль"
            value={next2}
            onChange={(e) => setNext2(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className={`field w-full ${next2 && next1 !== next2 ? "border-red-700/60" : ""}`}
          />

          {pwdMsg && (
            <div
              className={`rounded-xl px-4 py-3 text-sm border ${
                pwdMsg.ok
                  ? "bg-green-950/30 border-green-700/30 text-green-300"
                  : "bg-red-950/40 border-red-700/30 text-red-300"
              }`}
            >
              {pwdMsg.text}
            </div>
          )}

          <button type="submit" disabled={pwdBusy} className="btn btn-primary">
            {pwdBusy ? "Секунду…" : "Сменить пароль"}
          </button>
        </form>

        <p className="text-[11px] text-hint leading-relaxed mt-4">
          Восстановления пароля по почте пока нет. Забыл — владелец заведёт новое приглашение.
        </p>
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-white mb-2">Обучение</h2>
        <p className="text-sm text-zinc-400 leading-relaxed mb-4">Короткий тур по разделам дашборда — откроется поверх страницы.</p>
        <button onClick={restartTour} className="btn btn-primary">Пройти обучение ещё раз</button>
      </div>

      <div className={card}>
        <button
          onClick={signOut}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-red-800/40 text-red-300 hover:bg-red-900/20 transition"
        >
          Выйти
        </button>
      </div>
    </div>
  );
}
