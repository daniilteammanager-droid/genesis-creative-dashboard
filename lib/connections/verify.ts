import { listSheetTitles } from "@/lib/general-report/googleSheets";

// Подключение проверяется в момент сохранения, а не при первом открытии отчёта.
// Иначе человек узнаёт о нерабочем ключе через неделю пустых цифр и решает, что
// сломался дашборд.



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
