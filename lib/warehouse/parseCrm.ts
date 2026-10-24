// Числа CRM одной строки склада. Раньше здесь же разбирались выгрузки Torro
// из таблиц; их больше нет (Decision 061), остался тип — им пишет клиент Torro.
// Депозиты и повторные лежат четырьмя числами (Decision 039).

export interface CrmNumbers {
  clicks: number | null;
  subscribers: number | null;
  dialogs: number | null;
  registrations: number | null;
  depCount: number | null;
  depSum: number | null;
  redepCount: number | null;
  redepSum: number | null;
  unsubscribes: number | null;
}
