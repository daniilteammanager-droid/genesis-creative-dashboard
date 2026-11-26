import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import { checkAuthorize, type AuthorizeRequest } from "@/lib/mcp/store";

// Экран согласия AI-доступа (Decision 116): Claude или Codex прислал человека сюда, он вошёл в
// дашборд и решает, пускать ли. Под сессией (middleware вернёт сюда после входа вместе с запросом).

const FIELDS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const me = await getProfile();
  if (!me || me.status !== "active") redirect("/login");

  let request: AuthorizeRequest | null = null;
  let error: string | null = null;
  try {
    request = await checkAuthorize(get);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="min-h-screen bg-background text-white flex items-center justify-center p-6">
      <div className="w-full max-w-[440px]">
        <div className="flex justify-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="Genesis" className="only-dark h-16 w-auto object-contain" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white.png" alt="Genesis" className="only-light h-16 w-auto object-contain" />
        </div>
        <div className="card p-6">
          {request ? (
            <>
              <h1 className="page-title mb-3">Подключение AI</h1>
              <p className="text-sm text-zinc-300 mb-4">
                <b className="text-white">{request.client.name}</b> просит доступ к дашборду от имени <b className="text-white">{me.name || me.email}</b>.
              </p>
              <ul className="text-sm text-zinc-300 space-y-1.5 mb-4 list-disc pl-5">
                <li>Читать статистику, кампании и кабинеты, цифры и расшифровки крео, AI-разборы, чеки и отклонённые объявления — ровно то, что ты видишь в дашборде.</li>
                <li>Ставить на паузу, запускать и менять дневной бюджет кампаний в твоих кабинетах — как в Live Manager. Перед каждым изменением спросит тебя, о каждом напишет в Telegram.</li>
                <li>Заливать кампании автозаливом, сохранять сборки, загружать крео в Медиатеку и чинить отклонённые объявления — ссылка, ФП, Multi-advertiser, уникализация, как в «Автозаливе» и «Антиотклоне». Перед каждым заливом и изменением покажет, что сделает, и спросит тебя.</li>
                <li>Читать и вести твои задачи: добавлять, менять и удалять задачи на твоих холстах, создавать общие холсты.</li>
                <li>Видеть заявки на пополнение и собирать по ним сводку — как в разделе «Пополнения»: владелец — все, остальные — свои. Создавать заявки от твоего имени — спросив тебя; заявка сразу уходит в платёжный чат.</li>
                <li>Отключить можно в любой момент: Настройки → AI-доступ.</li>
              </ul>
              <p className="text-xs text-hint mb-5">После решения вернёт на <span className="text-zinc-300">{new URL(request.redirectUri).host}</span></p>
              <form method="post" action="/api/oauth/authorize" className="flex gap-2">
                {FIELDS.map((k) => (get(k) !== null ? <input key={k} type="hidden" name={k} value={get(k)!} /> : null))}
                <button name="decision" value="allow" className="btn btn-primary flex-1">Разрешить</button>
                <button name="decision" value="deny" className="btn flex-1">Отказать</button>
              </form>
            </>
          ) : (
            <>
              <h1 className="page-title mb-3">Не получилось подключить</h1>
              <p className="text-sm text-red-300 mb-2">{error}</p>
              <p className="text-xs text-hint">Удали коннектор в Claude или Codex и подключи заново. Не помогло — напиши владельцу дашборда.</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
