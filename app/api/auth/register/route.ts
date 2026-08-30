import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Регистрация по одноразовому приглашению.
//
// Настоящий запрет стоит в базе — триггер on_auth_user_created не даст создать
// пользователя без действительного токена (см. supabase/002_invites.sql). Здесь
// та же проверка повторяется заранее, чтобы человек увидел «приглашение уже
// использовано», а не «Database error saving new user».
//
// Service-role ключ обходит RLS и умеет в базе всё, поэтому он ТОЛЬКО здесь и
// только на сервере. В NEXT_PUBLIC_* его класть нельзя ни при каких условиях.

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const { email, password, name, inviteCode } = (await req.json()) as {
      email?: string; password?: string; name?: string; inviteCode?: string;
    };

    const supabase = admin();
    if (!supabase) {
      // Отсутствие настройки — явная ошибка, а не «тихо пустить всех».
      return NextResponse.json(
        { error: "Регистрация не настроена: нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    if (!email || !password || !name?.trim()) {
      return NextResponse.json({ error: "Заполни имя, почту и пароль" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Пароль короче 8 символов" }, { status: 400 });
    }

    const token = inviteCode?.trim() || null;

    // Самый первый аккаунт заводится без приглашения и становится владельцем —
    // выписать приглашение иначе было бы некому. Лазейка закрывается сама, как
    // только появился первый профиль.
    const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true });
    const isFirst = (count ?? 0) === 0;

    if (!isFirst) {
      if (!token) {
        return NextResponse.json({ error: "Нужно приглашение — попроси ссылку у тимлида" }, { status: 403 });
      }
      const { data: invite } = await supabase
        .from("invites")
        .select("token, used_at, expires_at")
        .eq("token", token)
        .maybeSingle();

      if (!invite) return NextResponse.json({ error: "Приглашение не найдено" }, { status: 403 });
      if (invite.used_at) return NextResponse.json({ error: "Приглашение уже использовано" }, { status: 403 });
      if (new Date(invite.expires_at) <= new Date()) {
        return NextResponse.json({ error: "Срок приглашения истёк" }, { status: 403 });
      }
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // внутренний контур, письма не шлём
      // Токен уезжает в метаданные — по нему триггер сверится ещё раз и погасит
      // приглашение в той же транзакции, что создаёт пользователя.
      user_metadata: { name: name.trim(), invite: token ?? "" },
    });

    if (error) {
      const exists = /already|exists|registered/i.test(error.message);
      const rejected = /invite|приглаш/i.test(error.message);
      return NextResponse.json(
        {
          error: exists ? "Такая почта уже зарегистрирована"
               : rejected ? "Приглашение недействительно"
               : error.message,
        },
        { status: exists ? 409 : 400 }
      );
    }

    // Профиль, роль и код баера создал триггер — читаем, что получилось.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, buyer_code")
      .eq("id", data.user.id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      role: profile?.role ?? null,
      buyerCode: profile?.buyer_code ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Register error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
