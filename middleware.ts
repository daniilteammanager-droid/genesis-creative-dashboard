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

  if (!user && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    // Куда человек шёл — вернём его туда после входа, а не на главную.
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (user && pathname === "/login") {
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
