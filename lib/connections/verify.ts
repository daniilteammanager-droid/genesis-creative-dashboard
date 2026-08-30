import * as XLSX from "xlsx";
import { listSheetTitles } from "@/lib/general-report/googleSheets";

// Подключение проверяется в момент сохранения, а не при первом открытии отчёта.
// Иначе человек узнаёт о нерабочем ключе через неделю пустых цифр и решает, что
// сломался дашборд.

const META = "https://graph.facebook.com/v26.0";

// 25 МБ: недельная выгрузка на два порядка меньше, а без потолка ссылка на
// что-нибудь огромное кладёт функцию по памяти.
const MAX_XLSX_BYTES = 25 * 1024 * 1024;

export async function verifyMetaToken(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${META}/me/adaccounts?limit=1&fields=id&access_token=${encodeURIComponent(token)}`);
    const body = (await res.json()) as { error?: { message?: string }; data?: unknown[] };
    if (body.error) {
      // Текст Meta бывает полезен («Session has expired»), но токен в него попасть не должен.
      return `Meta не приняла ключ: ${body.error.message ?? "причина не указана"}`;
    }
    if (!Array.isArray(body.data)) return "Meta ответила не тем, чем должна";
    if (body.data.length === 0) {
      return "Ключ рабочий, но не видит ни одного рекламного кабинета — проверь права";
    }
    return null;
  } catch {
    return "Не удалось достучаться до Meta — попробуй ещё раз";
  }
}

export async function verifySheet(spreadsheetId: string): Promise<string | null> {
  try {
    const titles = await listSheetTitles(spreadsheetId);
    if (titles.length === 0) return "Таблица открылась, но в ней нет ни одного листа";
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    if (/403|permission|PERMISSION_DENIED/i.test(msg)) {
      return `Нет доступа к таблице. Открой к ней доступ на чтение для ${email ?? "сервисного аккаунта"}`;
    }
    if (/404|not found/i.test(msg)) return "Таблица не найдена — проверь ключ таблицы";
    return `Не удалось прочитать таблицу: ${msg}`;
  }
}

export async function verifyXlsxUrl(url: string): Promise<string | null> {
  // Выгрузка Torro всегда живёт в Google Sheets, поэтому хост прибит гвоздями.
  // Без этого поле превращается в «сходи по любому адресу от имени сервера»:
  // залогиненный человек перебирал бы чужие адреса и порты нашим же IP, а по
  // тексту ответа понимал, что там кто-то есть.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Это не похоже на ссылку — нужна целиком, вместе с https://";
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "docs.google.com") {
    return "Ссылка должна вести на docs.google.com — это ссылка на экспорт таблицы";
  }

  let res: Response;
  try {
    // Таймаут обязателен: без него молчащий сервер держит функцию до предела Vercel.
    res = await fetch(parsed.toString(), { signal: AbortSignal.timeout(15_000) });
  } catch {
    // Сеть отдельно от разбора файла: иначе рабочей ссылке говорят «это не XLSX»,
    // и человек идёт чинить то, что не сломано.
    return "Не удалось открыть ссылку — проверь, что доступ к таблице открыт по ссылке";
  }
  if (!res.ok) {
    // Код ответа наружу не отдаём: он же и есть тот самый ответ «там кто-то есть».
    return "Ссылка не открывается — проверь доступ к таблице";
  }

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_XLSX_BYTES) return "Файл слишком большой для проверки";

  let buf: Buffer;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch {
    return "Не удалось дочитать файл по ссылке";
  }
  // Content-Length может отсутствовать или врать — проверяем и по факту.
  if (buf.byteLength > MAX_XLSX_BYTES) return "Файл слишком большой для проверки";

  try {
    const wb = XLSX.read(buf, { type: "buffer" });
    if (wb.SheetNames.length === 0) return "Файл открылся, но листов в нём нет";
  } catch {
    return "По ссылке пришёл не XLSX — нужна ссылка на экспорт, а не на саму таблицу";
  }

  // XLSX.read покладист: HTML-страницу таблицы он тоже разберёт и вернёт лист.
  // Поэтому проверяем и адрес: у экспорта в пути есть export, у страницы — edit.
  if (!/\/export\b/.test(parsed.pathname) && !parsed.searchParams.has("format")) {
    return "Похоже, это ссылка на саму таблицу, а не на экспорт XLSX — нужна ссылка вида /export?format=xlsx";
  }

  return null;
}
