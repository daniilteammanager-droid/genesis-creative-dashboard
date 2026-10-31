import { mskDay, mskDaysAgo } from "@/lib/day";

// Пресеты периодов Креативов — плитка и таблица. «Этот месяц» и «Прошлый месяц» — как в
// «Дашборде» Артёма. Раздел открывается на сегодня.

const month = (offset: number) => {
  const [y, m] = mskDay().split("-").map(Number);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { since: day(new Date(Date.UTC(y, m - 1 + offset, 1))), until: offset ? day(new Date(Date.UTC(y, m + offset, 0))) : mskDay() };
};

export const PERIODS = [
  { label: "Сегодня", since: () => mskDaysAgo(0), until: () => mskDaysAgo(0) },
  { label: "Вчера", since: () => mskDaysAgo(1), until: () => mskDaysAgo(1) },
  { label: "7 дней", since: () => mskDaysAgo(6), until: () => mskDaysAgo(0) },
  { label: "14 дней", since: () => mskDaysAgo(13), until: () => mskDaysAgo(0) },
  { label: "30 дней", since: () => mskDaysAgo(29), until: () => mskDaysAgo(0) },
  { label: "Этот месяц", since: () => month(0).since, until: () => month(0).until },
  { label: "Прошлый месяц", since: () => month(-1).since, until: () => month(-1).until },
];
