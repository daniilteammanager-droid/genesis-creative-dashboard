import { parseName } from "@/lib/creatives/code";

// Чек в формате Genesis Manager Артёма (checks.cjs → buildReport), Decision 090. Чистая функция.
//
//   Сегодня - Кампании
//
//   Латам - $300 + $150 тест
//
//   Мексика · Роман
//
//   Активные
//   CAB2074_26.10_TG_EXP_MEX_MTG_ROMAN_1 [$50]
//   $12.40 / $2.07 / $6.20
//
//   Проблемные активные
//   …
//   Причина: ПДП $4.10 >= $3.50
//
//   Стопнутые / Бан
//   … [$100] - БАН
//
//   Общ. Латам:
//   $996.08 / $5.22 / $28.46
//   ПДП: 191 / ДИА: 35
//
// Регион и страна — нашим разбором имени (parseName), а не регэкспом Артёма: его разбор не
// узнаёт нейминг Андрея «26.10_1818_TG_EXP_AR_…» и уводит его в «Другие GEO».

export interface ArtemCampaign {
  name: string; spend: number; budget: number | null;
  status: string | null;     // фактический статус кампании; null — не знаем (считаем активной)
  banned: boolean;           // кабинет в бане, unsettled, закрыт или пропал
  subscribers: number | null; dialogs: number | null; revenue: number | null;
}
export interface ArtemTorro { name: string; subscribers: number; dialogs: number; revenue: number }
export interface Thresholds {
  latamNoPdp: number; latamCpaPdp: number; latamCpaDia: number;
  spainNoPdp: number; spainCpaPdp: number; spainCpaDia: number; spainDiaMinSpend: number;
}
// Пороги «проблемной» кампании — как в DEFAULT_THRESHOLDS Артёма.
export const THRESHOLDS: Thresholds = {
  latamNoPdp: 10, latamCpaPdp: 3.5, latamCpaDia: 10,
  spainNoPdp: 15, spainCpaPdp: 25, spainCpaDia: 35, spainDiaMinSpend: 100,
};

type Group = "латам" | "латам wa" | "испания тг" | "испания wa" | "другие" | "другие wa";
const ORDER: Group[] = ["латам", "латам wa", "испания тг", "испания wa", "другие", "другие wa"];
const GROUP_LABEL: Record<Group, string> = {
  "латам": "Латам", "латам wa": "Латам WA", "испания тг": "Испания TG", "испания wa": "Испания WA",
  "другие": "Другие GEO", "другие wa": "Другие GEO WA",
};
const LATAM = new Set(["AR", "MX", "CO", "CL", "PE", "PY", "UY", "EC", "PA", "LATAM"]);
const COUNTRY: Record<string, string> = {
  ES: "Испания", MX: "Мексика", CL: "Чили", PE: "Перу", AR: "Аргентина", CO: "Колумбия",
  PY: "Парагвай", UY: "Уругвай", EC: "Эквадор", PA: "Панама", LATAM: "Латам-микс",
};
const ACTOR: Record<string, string> = { ROMAN: "Роман", RICKY: "Рики" };

const usd = (v: number) => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);
const short = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y.slice(-2)}`; };

function identity(name: string) {
  const p = parseName(name);
  const up = name.toUpperCase();
  // Старые РК без лица в имени — Роман (как у Артёма и в боте-авточекере).
  const actor = p.face ?? (/(?:^|[_\s-])(RICKY|RIKI|RICARDO)(?:[_\s-]|$)/.test(up) ? "RICKY" : "ROMAN");
  const geo = p.geo ?? (/SPAIN/.test(up) ? "ES" : undefined);
  const wa = p.funnel === "WA" || /(?:^|[_\s-])WA(?:[_\s-]|$)|WA-/.test(up);
  const group: Group = geo === "ES" ? (wa ? "испания wa" : "испания тг") : geo && LATAM.has(geo) ? (wa ? "латам wa" : "латам") : (wa ? "другие wa" : "другие");
  return { group, geo, day: p.day, bucket: `${geo ? COUNTRY[geo] ?? `GEO ${geo}` : "Неизвестное GEO"} · ${ACTOR[actor] ?? actor}` };
}

export function groupOf(name: string): Group { return identity(name).group; }

export function reasons(group: Group, c: ArtemCampaign, t: Thresholds = THRESHOLDS): string[] {
  const spend = c.spend, sub = c.subscribers ?? 0, chat = c.dialogs ?? 0;
  const pdp = sub ? spend / sub : 0, dia = chat ? spend / chat : 0, out: string[] = [];
  if (group.startsWith("латам")) {
    if (sub === 0 && spend >= t.latamNoPdp) out.push(`нет ПДП при спенде ${usd(spend)}`);
    if (sub > 0 && pdp >= t.latamCpaPdp) out.push(`ПДП ${usd(pdp)} >= $${t.latamCpaPdp.toFixed(2)}`);
    if (chat > 0 && dia >= t.latamCpaDia) out.push(`чат ${usd(dia)} >= $${t.latamCpaDia.toFixed(0)}`);
  } else if (group.startsWith("испания")) {
    if (sub === 0 && spend >= t.spainNoPdp) out.push(`нет ПДП при спенде ${usd(spend)} (порог $${t.spainNoPdp.toFixed(0)})`);
    if (sub > 0 && pdp >= t.spainCpaPdp) out.push(`ПДП ${usd(pdp)} >= $${t.spainCpaPdp.toFixed(0)}`);
    if (chat > 0 && dia > t.spainCpaDia && spend > t.spainDiaMinSpend) out.push(`ДИА ${usd(dia)} > ${usd(t.spainCpaDia)} при спенде ${usd(spend)} > ${usd(t.spainDiaMinSpend)}`);
  }
  return out;
}

const isActive = (c: ArtemCampaign) => !c.banned && (c.status === null || c.status === "ACTIVE");

// tg — кампании TG Ads: у Артёма их не было, идут отдельным блоком после общего итога Facebook.
export function buildArtemText(campaigns: ArtemCampaign[], torro: ArtemTorro[], o: {
  since: string; until: string; today: string; activeOnly?: boolean; thresholds?: Thresholds; tg?: ArtemCampaign[];
}): string {
  const t = o.thresholds ?? THRESHOLDS;
  const suffix = o.activeOnly ? "Активные кампании" : "Кампании";
  const head = o.since === o.until && o.until === o.today ? `Сегодня - ${suffix}` : o.since === o.until ? `${short(o.since)} - ${suffix}` : `${short(o.since)}–${short(o.until)} - ${suffix}`;
  const lines = [head, ""];

  // Видимые — со спендом или активные (свежая кампания до первого цента тоже в чеке).
  const all = campaigns.filter((c) => c.name && (c.spend >= 0.01 || isActive(c)));
  if (!all.length) return [...lines, "Нет кампаний со спендом за период."].join("\n");
  // «Только активные» прячет строки, но не меняет итоги групп (как у Артёма).
  const shown = o.activeOnly ? all.filter(isActive) : all;

  // Итоги Torro по группам — по всем строкам Torro, в том числе без расхода в чеке.
  const totals = new Map<Group, { sub: number; chat: number }>();
  const add = (g: Group, sub: number, chat: number) => { const x = totals.get(g) ?? { sub: 0, chat: 0 }; x.sub += sub; x.chat += chat; totals.set(g, x); };
  for (const c of all) add(identity(c.name).group, c.subscribers ?? 0, c.dialogs ?? 0);
  const unparsed: ArtemTorro[] = [];
  for (const r of torro) {
    const id = identity(r.name);
    if (id.geo) add(id.group, r.subscribers, r.dialogs); else unparsed.push(r);
  }

  const label = o.today.slice(8, 10) + "." + o.today.slice(5, 7);
  const canTest = o.until === o.today;
  const order = (a: ArtemCampaign, b: ArtemCampaign) => {
    const ka = identity(a.name).day ?? "99.99", kb = identity(b.name).day ?? "99.99";
    return ka.slice(3).localeCompare(kb.slice(3)) || ka.localeCompare(kb) || a.name.localeCompare(b.name);
  };
  const render = (c: ArtemCampaign, rs?: string[]) => {
    const flag = c.banned ? " - БАН" : c.status && c.status !== "ACTIVE" ? " - СТОП" : "";
    const sub = c.subscribers ?? 0, chat = c.dialogs ?? 0;
    lines.push(`${c.name} ${c.budget ? `[${usd(c.budget)}]` : "[—]"}${flag}`, `${usd(c.spend)} / ${usd(sub ? c.spend / sub : 0)} / ${usd(chat ? c.spend / chat : 0)}`);
    if (rs?.length) lines.push(`Причина: ${rs.join(", ")}`);
    lines.push("");
  };

  let grandSpend = 0;
  for (const g of ORDER) {
    const inGroup = all.filter((c) => identity(c.name).group === g);
    const visible = shown.filter((c) => identity(c.name).group === g);
    const spend = inGroup.reduce((s, c) => s + c.spend, 0);
    if (spend <= 0 && !inGroup.some(isActive)) continue;
    // Бюджет — только живых кампаний; стопнутые и забаненные свой бюджет не тратят.
    const live = inGroup.filter((c) => isActive(c) && c.budget);
    const parts: string[] = [];
    if (canTest) {
      const test = (c: ArtemCampaign) => identity(c.name).day === label;
      const standing = live.filter((c) => !test(c)).reduce((s, c) => s + c.budget!, 0);
      const tests = live.filter(test).reduce((s, c) => s + c.budget!, 0);
      if (standing > 0) parts.push(usd(standing));
      if (tests > 0) parts.push(`${usd(tests)} тест`);
    } else {
      const b = live.reduce((s, c) => s + c.budget!, 0);
      if (b > 0) parts.push(usd(b));
    }
    lines.push(`${GROUP_LABEL[g]} - ${parts.length ? parts.join(" + ") : "—"}`, "");

    const buckets = new Map<string, ArtemCampaign[]>();
    for (const c of visible) { const k = identity(c.name).bucket; buckets.set(k, [...(buckets.get(k) ?? []), c]); }
    for (const [bucket, list] of [...buckets].sort((a, b) => a[0].localeCompare(b[0], "ru"))) {
      lines.push(bucket, "");
      const active: ArtemCampaign[] = [], problem: { c: ArtemCampaign; rs: string[] }[] = [], stopped: ArtemCampaign[] = [];
      for (const c of list) {
        if (!isActive(c)) { stopped.push(c); continue; }
        const rs = reasons(g, c, t);
        if (rs.length) problem.push({ c, rs }); else active.push(c);
      }
      stopped.sort((a, b) => Number(b.banned) - Number(a.banned) || order(a, b));
      if (active.length) { lines.push("Активные", ""); active.sort(order).forEach((c) => render(c)); }
      if (problem.length) { lines.push("Проблемные активные", ""); problem.sort((a, b) => order(a.c, b.c)).forEach((x) => render(x.c, x.rs)); }
      if (stopped.length) { lines.push("Стопнутые / Бан", ""); stopped.forEach((c) => render(c)); }
    }
    const tot = totals.get(g) ?? { sub: 0, chat: 0 };
    lines.push(`Общ. ${GROUP_LABEL[g]}:\n${usd(spend)} / ${usd(tot.sub ? spend / tot.sub : 0)} / ${usd(tot.chat ? spend / tot.chat : 0)}`,
      `ПДП: ${Math.trunc(tot.sub)} / ДИА: ${Math.trunc(tot.chat)}`, "");
    grandSpend += spend;
  }
  let sub = 0, chat = 0;
  for (const x of totals.values()) { sub += x.sub; chat += x.chat; }
  lines.push(`Общий итог:\n${usd(grandSpend)} / ${usd(sub ? grandSpend / sub : 0)} / ${usd(chat ? grandSpend / chat : 0)}`, `ПДП: ${Math.trunc(sub)} / ДИА: ${Math.trunc(chat)}`);
  const tg = (o.tg ?? []).filter((c) => c.spend >= 0.01 || isActive(c));
  if (tg.length) {
    const spend = tg.reduce((x, c) => x + c.spend, 0), tsub = tg.reduce((x, c) => x + (c.subscribers ?? 0), 0), tchat = tg.reduce((x, c) => x + (c.dialogs ?? 0), 0);
    const budget = tg.filter((c) => isActive(c) && c.budget).reduce((x, c) => x + c.budget!, 0);
    lines.push("", `TG Ads - ${budget > 0 ? usd(budget) : "—"}`, "");
    for (const c of [...tg].sort((a, b) => b.spend - a.spend)) if (!o.activeOnly || isActive(c)) render(c);
    lines.push(`Общ. TG Ads:\n${usd(spend)} / ${usd(tsub ? spend / tsub : 0)} / ${usd(tchat ? spend / tchat : 0)}`, `ПДП: ${Math.trunc(tsub)} / ДИА: ${Math.trunc(tchat)}`);
  }
  if (unparsed.length) {
    lines.push("", "Неразобранное (Торро):", "");
    for (const r of [...unparsed].sort((a, b) => b.subscribers - a.subscribers || a.name.localeCompare(b.name))) {
      const p = [`${Math.trunc(r.subscribers)} лидов`, `${Math.trunc(r.dialogs)} чатов`];
      if (r.revenue > 0) p.push(`деп ${usd(r.revenue)}`);
      lines.push(`${r.name || "(пусто)"} — ${p.join(", ")}`);
    }
  }
  return lines.join("\n");
}
