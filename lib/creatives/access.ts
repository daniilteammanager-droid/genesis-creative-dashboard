import type { Profile } from "@/lib/auth/types";

// Что баеру видно и что ему можно трогать в R2 (Decision 077).
//
// Папка баера — его код: её задаёт сервер при выдаче ссылки на загрузку, а не имя
// файла (Decision 034), поэтому по ней и судим. Строке creative_uploads верить
// нельзя: её переписывает любой, кто запросил ссылку с тем же кодом крео.
//
// Видно: своя папка и всё, что не лежит в папке другого баера, — легаси-библиотека
// и загрузки владельца с тимлидом. Трогать: только свою папку.
// ponytail: смена кода баера отрезает его от старой папки — коды не меняются (Decision 028).

const BUYER_FOLDER = /^b\d+\//i;

export function mayManageKey(me: Pick<Profile, "role" | "buyer_code">, key: string): boolean {
  if (me.role !== "buyer") return true;
  return Boolean(me.buyer_code) && key.toLowerCase().startsWith(`${me.buyer_code!.toLowerCase()}/`);
}

export function maySeeKey(me: Pick<Profile, "role" | "buyer_code">, key: string): boolean {
  return mayManageKey(me, key) || !BUYER_FOLDER.test(key);
}
