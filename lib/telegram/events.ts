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
}

export const EVENTS: TelegramEvent[] = [
  { key: "cabinet_status", label: "Статус кабинетов", hint: "заблокирован, пропал, grace period, unsettled и обратно", ready: false },
  { key: "cabinet_balance", label: "Баланс и оплата", hint: "баланс кабинета и ссылка на оплату в Meta", ready: false },
  { key: "ad_rejected", label: "Отклонённые объявления", hint: "причина отклонения и кнопки действий", ready: false },
  { key: "autocheck", label: "Чек по расписанию", hint: "живой чек в выбранное время", ready: false },
  { key: "autoupload", label: "Автозалив", hint: "ход и итог заливки", ready: false },
  { key: "connection_broken", label: "Слетевшие подключения", hint: "ключ Meta или Torro перестал работать", ready: false },
];

export const EVENT_KEYS = EVENTS.map((e) => e.key);

// Новая привязка получает всё: выключить лишнее проще, чем догадаться включить.
export const DEFAULT_EVENTS = EVENT_KEYS;

export function cleanEvents(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("events — список ключей");
  const known = new Set(EVENT_KEYS);
  return [...new Set(input.map(String))].filter((k) => known.has(k));
}
