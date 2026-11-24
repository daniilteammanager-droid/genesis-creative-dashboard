import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { juniorAreas, juniorMay } from "@/lib/nav";

// Единственная дверь в дашборд. Без сессии сюда не пройти — раньше страницы и
// роуты были открыты всем, кто знает адрес, включая запись и удаление в R2.
//
// Заодно продлевает сессию: токен обновляется здесь и уезжает обратно в cookies,
// иначе через час работы пользователя выкидывало бы на логин.

// /api/ingest сюда входит не потому, что он публичный, а потому что его дёргает
// крон с VPS, у которого нет и не может быть сессии. Он закрыт общим секретом в
// заголовке — проверка внутри самого роута.
// /api/telegram/webhook зовёт Telegram, вход в нём закрыт своим секретом.
// Именно webhook, а не весь /api/telegram: привязки рядом — под сессией.
const PUBLIC_PATHS = ["/login", "/api/auth/register", "/api/ingest", "/api/telegram/webhook", "/api/topups/webhook", "/api/uniq"];

// AI-доступ по MCP (Decision 116): сюда ходят Claude и Codex, у них нет cookie — вход по Bearer
// внутри самих роутов, метаданные OAuth открыты по стандарту. Сессию для них не читаем вовсе:
// это лишний поход в Supabase на каждый вызов инструмента. /api/oauth/authorize (кнопка
// согласия) сюда не входит — она под сессией.
const BEARER_PATHS = ["/api/mcp", "/api/oauth/token", "/api/oauth/register", "/api/oauth/metadata", "/api/oauth/resource", "/.well-known"];
const under = (pathname: string, p: string) => pathname === p || pathname.startsWith(`${p}/`);

// Статус читается на каждой навигации, и это второй поход в Supabase поверх
// getUser(). Пара сотен миллисекунд на каждый клик — заметно руками.
//
// Держим ответ полминуты в памяти инстанса. Цена: отключённый доживает до
// полуминуты в приложении. Это приемлемо — на уровне базы его уже не пускает
// app_role() (Decision 033), то есть второй рубеж работает без задержки.
const STATUS_TTL_MS = 30_000;
// У джуна заодно — его разделы на деле и AI-доступ (060_junior.sql): закрытый раздел режется здесь же,
// и страница, и её API. Поменяли разделы — доходит за те же полминуты.
type Junior = { areas: string[]; mcp: boolean };
const statusCache = new Map<string, { blocked: boolean; junior: Junior | null; at: number }>();

export async function middleware(request: NextRequest) {
  if (BEARER_PATHS.some((p) => under(request.nextUrl.pathname, p))) return NextResponse.next();
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
  const isPublic = PUBLIC_PATHS.some((p) => under(pathname, p));

  // Отключённый в «Команде» обязан терять доступ, а не только админские вкладки.
  // Проверка стоит здесь, потому что это единственное место, через которое проходят
  // и страницы, и app/api/*: роуты профиль не читают вообще, а страницы отчётов —
  // клиентские. Отключение через Supabase Auth сессию не отзывает, так что без этой
  // проверки кнопка «отключён» не делала ровно ничего.
  let blocked = false;
  let junior: Junior | null = null;
  if (user) {
    const hit = statusCache.get(user.id);
    if (hit && Date.now() - hit.at < STATUS_TTL_MS) {
      blocked = hit.blocked;
      junior = hit.junior;
    } else {
      const { data, error } = await supabase
        .from("profiles")
        .select("status, role, junior_areas, junior_mcp")
        .eq("id", user.id)
        .maybeSingle();
      // Ошибка — это недоступный Supabase, а не запрет: дашборд не должен падать
      // вместе с ним (Decision 005). Запираем только когда ответ получен и он не
      // «active» — включая случай, когда профиля нет вовсе.
      blocked = !error && data?.status !== "active";
      // Джун: разделы — свои ∩ разделы баера. Баер не прочитался — только личное, и это не кэшируем.
      let fresh = !error;
      if (data?.role === "junior") {
        const { data: b, error: e } = await supabase.rpc("junior_buyer").maybeSingle<{ status: string; role: string; legacy_access: boolean }>();
        junior = { areas: juniorAreas(data.junior_areas as string[] | null, e ? null : b), mcp: data.junior_mcp === true };
        fresh = fresh && !e;
      }
      // Ошибку не кэшируем: иначе одна моргнувшая секунда Supabase раздаёт
      // пропуск на полминуты вперёд.
      if (fresh) statusCache.set(user.id, { blocked, junior, at: Date.now() });
    }
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
    // Куда человек шёл — вернём его туда после входа, а не на главную. Вместе с запросом:
    // экрану согласия AI-доступа (/oauth/authorize) без параметров OAuth делать нечего.
    else login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  // Джун — только в свои разделы. Страницу закрытого — на «/» (стартовая из открытых), API — отказ.
  if (user && !blocked && junior && !juniorMay(pathname, junior.areas, junior.mcp)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Этот раздел джуну закрыт" }, { status: 403 });
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
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
