"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/client";
import { ROLE_LABELS, type Profile } from "@/lib/auth/types";

const field =
  "w-full bg-[#0d0b14] border border-violet-900/40 rounded-xl px-4 py-3 outline-none " +
  "focus:border-violet-600/50 transition placeholder:text-zinc-600 text-white";

const card = "bg-[#111118] border border-violet-900/30 rounded-2xl p-6";

const button =
  "px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 " +
  "text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50";

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
          <dt className="text-zinc-600">Почта</dt>
          <dd className="text-zinc-300">{profile.email}</dd>
          <dt className="text-zinc-600">Роль</dt>
          <dd className="text-zinc-300">{ROLE_LABELS[profile.role]}</dd>
          {profile.buyer_code && (
            <>
              <dt className="text-zinc-600">Код баера</dt>
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
            className={`${field} flex-1 min-w-[200px]`}
          />
          <button type="submit" disabled={nameBusy} className={button}>
            {nameBusy ? "Секунду…" : "Сохранить"}
          </button>
        </form>
        {nameMsg && <p className="text-xs text-zinc-500 mt-2">{nameMsg}</p>}

        <p className="text-[11px] text-zinc-600 leading-relaxed mt-4">
          Почту, роль и код баера меняет только владелец — на вкладке «Команда».
        </p>
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
            className={field}
          />
          <input
            type="password"
            placeholder="Новый пароль"
            value={next1}
            onChange={(e) => setNext1(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className={field}
          />
          <input
            type="password"
            placeholder="Повтори новый пароль"
            value={next2}
            onChange={(e) => setNext2(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className={`${field} ${next2 && next1 !== next2 ? "border-red-700/60" : ""}`}
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

          <button type="submit" disabled={pwdBusy} className={button}>
            {pwdBusy ? "Секунду…" : "Сменить пароль"}
          </button>
        </form>

        <p className="text-[11px] text-zinc-600 leading-relaxed mt-4">
          Восстановления пароля по почте пока нет. Забыл — владелец заведёт новое приглашение.
        </p>
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
