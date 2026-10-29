// Какие уведомления бывают. Ключ лежит в telegram_links.events.
//
// ready — событие уже кто-то шлёт. Неготовые видны в настройках с пометкой
// «скоро»: человек выбирает заранее, и когда этап доедет, бот сразу начнёт слать
// туда, куда надо, без второго захода в настройки.

export interface TelegramEvent {
  key: string;
  label: string;
  hint: string;
  ready: boolean;
  roles?: string[];   // кому показывать; нет — всем
}

export const EVENTS: TelegramEvent[] = [
  { key: "cabinet_status", label: "Статус кабинетов", hint: "заблокирован, пропал, grace period, unsettled и обратно", ready: true },
  { key: "cabinet_balance", label: "Баланс и оплата", hint: "баланс кабинета и ссылка на оплату в Meta", ready: false },
  { key: "ad_rejected", label: "Отклонённые объявления", hint: "причина отклонения и ссылка на объявление", ready: true },
  { key: "autocheck", label: "Чек по расписанию", hint: "живой чек за сегодня в выбранное время", ready: true },
  { key: "daily_summary", label: "Сводка за вчера", hint: "в 10:00 МСК: расход, доход и ROMI по баерам, блокировки и отклонения — владельцу и тимлиду", ready: true, roles: ["main", "teamlead"] },
  { key: "autoupload", label: "Автозалив", hint: "ход и итог заливки", ready: false },
  { key: "connection_broken", label: "Слетевшие подключения", hint: "аккаунт FB Tool разлогинился или снова в строю, ключ Meta перестал работать", ready: true },
  { key: "test_limit", label: "Крео за границей теста", hint: "крео без депов потратило 2,5 × целевой цены депа страны и ещё крутится", ready: true },
];

export const EVENT_KEYS = EVENTS.map((e) => e.key);

// Новая привязка получает всё: выключить лишнее проще, чем догадаться включить.
export const DEFAULT_EVENTS = EVENT_KEYS;

export function cleanEvents(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("events — список ключей");
  const known = new Set(EVENT_KEYS);
  return [...new Set(input.map(String))].filter((k) => known.has(k));
}
