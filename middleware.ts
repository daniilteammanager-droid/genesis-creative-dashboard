import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Единственная дверь в дашборд. Без сессии сюда не пройти — раньше страницы и
// роуты были открыты всем, кто знает адрес, включая запись и удаление в R2.
//
// Заодно продлевает сессию: токен обновляется здесь и уезжает обратно в cookies,
// иначе через час работы пользователя выкидывало бы на логин.

const PUBLIC_PATHS = ["/login", "/api/auth/register"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // getUser(), а не getSession(): он проверяет подпись токена на сервере Supabase.
  // getSession() верит cookie на слово, а cookie подделывается.
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Отключённый в «Команде» обязан терять доступ, а не только админские вкладки.
  // Проверка стоит здесь, потому что это единственное место, через которое проходят
  // и страницы, и app/api/*: роуты профиль не читают вообще, а страницы отчётов —
  // клиентские. Отключение через Supabase Auth сессию не отзывает, так что без этой
  // проверки кнопка «отключён» не делала ровно ничего.
  let blocked = false;
  if (user) {
    const { data, error } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    // Ошибка — это недоступный Supabase, а не запрет: дашборд не должен падать
    // вместе с ним (Decision 005). Запираем только когда ответ получен и он не
    // «active» — включая случай, когда профиля нет вовсе.
    blocked = !error && data?.status !== "active";
  }

  if ((!user || blocked) && !isPublic) {
    // Клиентский fetch ждёт JSON. Редирект на HTML логина он разбирает как
    // «Unexpected token <» и показывает пользователю не ту причину.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: blocked ? "Доступ отключён" : "Нужно войти" },
        { status: 401 }
      );
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    // Отключённому — сказать, почему его развернуло. Иначе он видит форму входа,
    // успешно вводит верный пароль и снова оказывается на ней же.
    if (blocked) login.searchParams.set("disabled", "1");
    // Куда человек шёл — вернём его туда после входа, а не на главную.
    else login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Отключённого с /login не уводим: увести его некуда — на любой странице его
  // развернёт обратно, и получится бесконечный редирект.
  if (user && !blocked && pathname === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  // Статика и картинки мимо: гонять их через проверку сессии незачем.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo-dark.png|brand/|.*\\.(?:png|jpg|jpeg|svg|webp|mp4|mov)$).*)"],
};
