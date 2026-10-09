import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/auth/server";
import type { Profile } from "@/lib/auth/types";
import type { Gr4Kind, Gr4SourceInfo } from "./types";

// Откуда читает GR 4.0. Правила те же, что у GR 3.0 (Decision 035):
//   баер — только своя таблица, из профиля;
//   владелец и тимлид — общая таблица (gr_spreadsheets, kind = 'v4') и таблица
//   любого баера, у которого она подключена на странице «Команда».

interface Source extends Gr4SourceInfo {
  spreadsheetId: string;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Не заданы NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function collectSources4(me: Profile): Promise<Source[]> {
  if (me.role === "buyer") {
    return me.gr4_spreadsheet_id
      ? [{ id: "me", label: "Моя таблица", kind: "buyer", spreadsheetId: me.gr4_spreadsheet_id }]
      : [];
  }

  const out: Source[] = [];

  const supabase = await createClient();
  const { data: main } = await supabase
    .from("gr_spreadsheets")
    .select("name, spreadsheet_id")
    .eq("kind", "v4")
    .order("created_at", { ascending: true })
    .limit(1);
  if (main?.[0]) out.push({ id: "main", label: main[0].name || "Общая", kind: "main", spreadsheetId: main[0].spreadsheet_id });

  // Сервисным ключом нарочно: тимлиду политика profiles показывает только его
  // баеров, а отчёт он видит по всей команде (Decision 035).
  const { data: buyers } = await serviceClient()
    .from("profiles")
    .select("id, name, email, buyer_code, gr4_spreadsheet_id")
    .eq("role", "buyer")
    .not("gr4_spreadsheet_id", "is", null)
    .order("buyer_code", { ascending: true });

  for (const b of buyers ?? []) {
    out.push({
      id: `buyer:${b.id}`,
      label: b.name || b.buyer_code || b.email,
      kind: "buyer" as Gr4Kind,
      spreadsheetId: b.gr4_spreadsheet_id as string,
    });
  }
  return out;
}

// Наружу — без ключей таблиц.
export const publicSources4 = (all: Source[]): Gr4SourceInfo[] => all.map(({ id, label, kind }) => ({ id, label, kind }));
