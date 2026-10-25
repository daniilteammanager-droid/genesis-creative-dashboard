import type { UserRole } from "@/lib/auth/types";

// Обучалка по дашборду (Decision 078): тур с подсветкой. Шаг подсвечивает блок
// с data-tour="…" на своей странице и показывает рядом подсказку.
//   click — «нажми»: дальше по клику на сам блок (раздел в меню — переход в раздел);
//   next  — пояснение, дальше по кнопке.
// Нет цели (или её не видно, как меню на телефоне) — подсказка по центру, и
// «Дальше» сам переводит на страницу следующего шага.
// Новая рабочая область — новые шаги сюда и data-tour на её блоки.

export interface Step {
  target?: string;          // data-tour блока
  route?: string;           // где этот блок живёт; у «нажми» — куда ведёт клик
  action?: "click" | "next";
  title: string;
  text: string;
  roles?: UserRole[];       // кому показывать; нет — всем
}

export const STEPS: Step[] = [
  {
    title: "👋 Добро пожаловать в Genesis Dashboard",
    text: "Здесь креативы, статистика, чеки, отчёты и пополнения — в одном месте. Цифры собираются сами из твоих подключений каждые 15 минут. Пройдёмся по разделам — пара минут.",
  },
  { target: "nav:/", action: "click", route: "/", title: "Легаси крео", text: "Общая библиотека креативов команды со статистикой за всё время. Нажми, чтобы открыть." },
  { target: "legacy-tabs", route: "/", title: "Креативы и аналитика", text: "Две вкладки: карточки креативов и аналитика — победители, проигравшие, тесты, расход по подходам." },
  { target: "legacy-search", route: "/", title: "Поиск", text: "Ищи креатив по коду или его части: «storytell», «b3», «es»." },
  { target: "legacy-filters", route: "/", title: "Фильтры", text: "Win — окупились, Lose — нет, Test — ещё мало данных. ★ Fav — твоё избранное." },
  { target: "legacy-tools", route: "/", title: "Сортировка и загрузка", text: "Сортируй по ROMI, расходу или депам, фильтруй по подходу. «Загрузить» — новые крео в библиотеку." },
  { target: "legacy-summary", route: "/", title: "Сводка", text: "Итоги по тому, что сейчас отфильтровано: расход, доход, ROMI, депы." },
  { target: "legacy-card", route: "/", title: "Карточка креатива", text: "Клик по карточке — видео, расшифровка текста, заметка и избранное." },

  { target: "nav:/creatives", action: "click", route: "/creatives", title: "Креативы", text: "Новая картотека — только твои креативы за выбранный период. Нажми." },
  { target: "creatives-views", route: "/creatives", title: "Плитка, таблица, аналитика", text: "Плитка — с превью, таблица — те же цифры столбцами, как в Reports. Сверху — период." },

  { target: "nav:/check", action: "click", route: "/check", title: "Checks", text: "Чек за сегодня в пару кликов. Нажми." },
  { target: "check-modes", route: "/check", title: "Живой и ручной", text: "Живой — из подключений, сразу по лицам и площадкам. Ручной — сверка выгрузок XLSX, запасной путь." },
  { target: "check-text", route: "/check", title: "Готовый чек", text: "Текст для телеги уже собран — «Скопировать» и отправляй." },

  { target: "nav:/reports", action: "click", route: "/reports", title: "Reports", text: "Отчёт как в FB Tool. Нажми." },
  { target: "reports-views", route: "/reports", title: "Кампании и креативы", text: "Дерево кампания → адсет → объявление или таблица по креативам. Столбцы как в General 4.0: ROMI, цена подписки и диалога, квалы." },
  { target: "reports-periods", route: "/reports", title: "Период", text: "Сегодня, вчера, неделя — или свои даты календарём." },

  { target: "nav:/general-report-4", action: "click", route: "/general-report-4", title: "General 4.0", text: "Сводная таблица по дням, неделям и месяцам — твоя, её подключает владелец. Нажми." },

  { target: "nav:/topups", action: "click", route: "/topups", title: "Пополнения", text: "Кабинеты, карты, агенты, расходники — только через заявку здесь. Нажми." },
  { target: "topups-form", route: "/topups", title: "Заявка", text: "Заполни все поля. Особенно сеть — перевод не в ту сеть не вернуть. Нечего добавить в комментарий — ставь «-»." },
  { target: "topups-list", route: "/topups", title: "Статус", text: "Здесь появится, что оплачено, сколько пришло, хэш и ссылка на транзакцию." },

  { target: "account", action: "click", route: "/settings", title: "Настройки", text: "Самое важное — подключения: без них отчёты пустые. Нажми на свой аккаунт." },
  { target: "int-facebook", route: "/settings/integrations", title: "Расход Facebook", text: "Один источник из трёх: ключ Meta, Dolphin Cloud или FB Tool. Ниже — Telegram Ads, кабинет на строку." },
  { target: "int-torro", route: "/settings/integrations", title: "Torro", text: "Ключ API и твой id баера — отсюда подписки, диалоги и депы. История догрузится сама." },
  { target: "int-telegram", route: "/settings/integrations", title: "Бот в Telegram", text: "Привяжи чат: бот пишет о блокировках кабинетов и отклонённых объявлениях с кнопками антиотклона и шлёт чек по расписанию." },

  {
    title: "👑 Для владельца и тимлида",
    text: "Reports и Checks — сводно по всей команде. В 10:00 МСК — сводка за вчера по баерам. Команда и приглашения — в настройках.",
    roles: ["main", "teamlead"],
  },
  { title: "🚀 Готово", text: "Начни с подключений — остальное заполнится само. Пройти обучение ещё раз: Настройки → Профиль." },
];

export const stepsFor = (role: UserRole) => STEPS.filter((s) => !s.roles || s.roles.includes(role));
