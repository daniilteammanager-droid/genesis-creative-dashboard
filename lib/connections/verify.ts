import { listSheetTitles } from "@/lib/general-report/googleSheets";

// Подключение проверяется в момент сохранения, а не при первом открытии отчёта.
// Иначе человек узнаёт о нерабочем ключе через неделю пустых цифр и решает, что
// сломался дашборд.

const META = "https://graph.facebook.com/v26.0";


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

// Кабинет по id: видит ли его этот ключ и как он называется.
//
// Проверяется в момент закрепления, а не при первом отчёте: человек должен
// сразу узнать, что ошибся цифрой, и увидеть имя кабинета рядом с id —
// набор цифр сам по себе ни о чём не говорит.
export async function verifyAdAccount(
  token: string,
  accountId: string
): Promise<{ id: string; name: string } | string> {
  try {
    const res = await fetch(
      `${META}/act_${encodeURIComponent(accountId)}?fields=id,name,account_status&access_token=${encodeURIComponent(token)}`
    );
    const body = (await res.json()) as {
      error?: { message?: string; code?: number };
      id?: string;
      name?: string;
      account_status?: number;
    };
    if (body.error) {
      // Meta отвечает одинаково и на «нет такого», и на «нет доступа» — для
      // человека это одно и то же: этот ключ такой кабинет не видит.
      return "Ключ Meta не видит кабинет с таким id — проверь цифры или доступ";
    }
    if (!body.id) return "Meta ответила не тем, чем должна";
    return { id: body.id.replace(/^act_/, ""), name: body.name ?? body.id };
  } catch {
    return "Не удалось достучаться до Meta — попробуй ещё раз";
  }
}
