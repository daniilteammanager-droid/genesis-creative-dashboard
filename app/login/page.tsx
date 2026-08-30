"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/auth/client";

type Mode = "signin" | "signup";

function LoginForm() {
  const params = useSearchParams();
  // Только внутренний путь. Без этой проверки ссылка вида
  // /login?next=https://чужой-сайт уводила бы человека наружу сразу после
  // ввода пароля — классический открытый редирект, и выглядит он убедительно,
  // потому что домен до входа настоящий.
  const rawNext = params.get("next") || "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const invited = params.get("invite");
  // Пришёл с флагом от middleware — аккаунт отключён. Без этой строки человек
  // вводит верный пароль и молча оказывается на той же форме.
  const disabled = params.get("disabled") === "1";

  // Пришёл по ссылке-приглашению — сразу открываем регистрацию с заполненным полем.
  const [mode, setMode] = useState<Mode>(invited ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [password2, setPassword2] = useState("");
  const [inviteCode, setInviteCode] = useState(invited ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function signIn() {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "Неверная почта или пароль" : error.message);
    // Полный переход, а не router.push: middleware должен увидеть новую cookie.
    window.location.assign(next);
  }

  async function signUp() {
    // Подтверждение пароля. Без него опечатка при регистрации запирает человека
    // снаружи молча: восстановления пароля пока нет, а прочитать его нельзя —
    // в базе лежит односторонний хеш.
    if (password !== password2) throw new Error("Пароли не совпадают");

    // Регистрация идёт через свой роут: код приглашения проверяется на сервере,
    // а публичная регистрация в Supabase выключена. Иначе зарегистрироваться мог
    // бы любой, кто знает адрес — anon-ключ лежит в бандле у всех на виду.
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name, inviteCode }),
    });
    const data = (await res.json()) as { error?: string; buyerCode?: string; role?: string };
    if (!res.ok) throw new Error(data.error ?? "Не удалось зарегистрироваться");

    const who = data.buyerCode ? `, твой код — ${data.buyerCode}` : data.role === "main" ? " — ты владелец" : "";
    setNotice(`Аккаунт создан${who}. Теперь войди.`);
    setMode("signin");
    setPassword("");
    setPassword2("");
    setInviteCode("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await (mode === "signin" ? signIn() : signUp());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Что-то пошло не так");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full bg-[#0d0b14] border border-violet-900/40 rounded-xl px-4 py-3 outline-none " +
    "focus:border-violet-600/50 transition placeholder:text-zinc-600 text-white";

  return (
    <main className="min-h-screen bg-[#0a080f] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center gap-6 mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="Genesis" className="h-20 w-auto object-contain" />
          <p className="text-violet-300/50 text-xs font-medium tracking-[0.2em] uppercase">
            Creative Dashboard
          </p>
        </div>

        <div className="bg-[#111118] border border-violet-900/30 rounded-2xl p-6">
          <div className="flex gap-1 mb-5 bg-[#0d0b14] border border-violet-900/40 rounded-xl p-1">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); setNotice(null); }}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  mode === m
                    ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm"
                    : "text-zinc-400 hover:text-violet-300"
                }`}
              >
                {m === "signin" ? "Вход" : "Регистрация"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <input
                type="text"
                placeholder="Имя"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className={field}
              />
            )}

            <input
              type="email"
              placeholder="Почта"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={field}
            />

            <input
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className={field}
            />

            {mode === "signup" && (
              <input
                type="password"
                placeholder="Повтори пароль"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={`${field} ${password2 && password !== password2 ? "border-red-700/60" : ""}`}
              />
            )}

            {mode === "signup" && (
              <>
                <input
                  type="text"
                  placeholder="Приглашение"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className={field}
                />
                <p className="text-[11px] text-zinc-600 leading-relaxed">
                  Приглашение одноразовое, его выдаёт тимлид. Номер баера присвоится сам.
                </p>
              </>
            )}

            {disabled && (
              <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm">
                Аккаунт отключён. Обратись к владельцу — вход не поможет.
              </div>
            )}

            {error && (
              <div className="bg-red-950/40 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            {notice && (
              <div className="bg-green-950/30 border border-green-700/30 rounded-xl px-4 py-3 text-green-300 text-sm">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full px-4 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm hover:from-violet-500 hover:to-violet-400 transition disabled:opacity-50"
            >
              {busy ? "Секунду…" : mode === "signin" ? "Войти" : "Зарегистрироваться"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams требует Suspense — иначе страница не соберётся статически.
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a080f]" />}>
      <LoginForm />
    </Suspense>
  );
}
