"use client";

import { useMemo } from "react";
import { parseCreativeCode } from "@/lib/creatives/code";
import type { CreativesResult, CreativeRow } from "@/lib/warehouse/creatives";

// Аналитика новой картотеки.
//
// Отличается от легаси-аналитики тем, что считает не «сколько», а «почём».
// Легаси показывает количество винеров у подхода — но подход с полусотней крео
// обгонит подход с пятью просто числом. И поднимает наверх крео с расходом в
// три доллара и одним депозитом: 20 000% и никакого смысла.
//
// Здесь всё меряется ценой результата и долей, а мелочь ниже порога зрелости
// в выводы не попадает.

const MATURE = 200;

const money = (v: number | null, d = 2) =>
  v === null || !Number.isFinite(v)
    ? "—"
    : `$${v.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const int = (v: number) => v.toLocaleString("ru-RU");
const pct = (v: number | null, d = 2) =>
  v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}%`;

const card = "bg-[#111118] border border-violet-900/30 rounded-2xl p-6";

const sum = (rows: CreativeRow[], f: (r: CreativeRow) => number | null) =>
  rows.reduce((s, r) => s + (f(r) ?? 0), 0);
const revenueOf = (r: CreativeRow) => (r.depSum ?? 0) + (r.redepSum ?? 0);
const per = (spend: number, count: number) => (count > 0 ? spend / count : null);

export default function CreativeAnalytics({
  data,
  loading,
}: {
  data: CreativesResult | null;
  loading: boolean;
}) {
  const a = useMemo(() => {
    const rows = data?.rows ?? [];
    if (rows.length === 0) return null;

    const spend = sum(rows, (r) => r.spend);
    const impressions = sum(rows, (r) => r.impressions);
    const clicks = sum(rows, (r) => r.clicks);
    const lpClicks = sum(rows, (r) => r.crmClicks);
    const pdp = sum(rows, (r) => r.subscribers);
    const dia = sum(rows, (r) => r.dialogs);
    const reg = sum(rows, (r) => r.registrations);
    const deps = sum(rows, (r) => r.depCount);
    const revenue = sum(rows, revenueOf);

    // Ступени воронки. Конверсия считается к предыдущей ступени, а не к показам:
    // так видно, где именно теряем, а не какой шаг дальше от начала.
    const funnel = [
      { label: "Показы", count: impressions, prev: null as number | null },
      { label: "Клики Meta", count: clicks, prev: impressions },
      { label: "Клики на лендинге", count: lpClicks, prev: clicks },
      { label: "ПДП", count: pdp, prev: lpClicks },
      { label: "Диалоги", count: dia, prev: pdp },
      // Регистрации в выгрузках Torro сейчас всегда ноль (замер 03.09.2026).
      // Показываем ступень, но депозиты считаем от диалогов, иначе пустая
      // ступень обнулила бы конверсию следующей и выглядела как провал.
      { label: "Регистрации", count: reg, prev: dia },
      { label: "Депозиты", count: deps, prev: reg > 0 ? reg : dia },
    ].map((s) => ({
      ...s,
      cost: per(spend, s.count),
      conv: s.prev && s.prev > 0 ? (s.count / s.prev) * 100 : null,
    }));

    // Группировка с общей арифметикой: цены считаются из СУММ группы, а не
    // усреднением цен отдельных крео (Decision 024).
    const group = (key: (r: CreativeRow) => string | undefined) => {
      const map = new Map<string, CreativeRow[]>();
      for (const r of rows) {
        const k = key(r);
        if (!k) continue;
        map.set(k, [...(map.get(k) ?? []), r]);
      }
      return [...map.entries()]
        .map(([name, list]) => {
          const s = sum(list, (r) => r.spend);
          const rev = sum(list, revenueOf);
          const mature = list.filter((r) => r.spend >= MATURE);
          const winners = mature.filter((r) => {
            const rv = revenueOf(r);
            return r.spend > 0 && ((rv - r.spend) / r.spend) * 100 >= 150;
          }).length;
          return {
            name,
            creatives: list.length,
            spend: s,
            revenue: rev,
            pdp: sum(list, (r) => r.subscribers),
            dia: sum(list, (r) => r.dialogs),
            deps: sum(list, (r) => r.depCount),
            costPdp: per(s, sum(list, (r) => r.subscribers)),
            costDia: per(s, sum(list, (r) => r.dialogs)),
            romi: s > 0 ? ((rev - s) / s) * 100 : null,
            // Доля винеров, а не их число: иначе выигрывает тот, кого просто больше.
            winRate: mature.length > 0 ? (winners / mature.length) * 100 : null,
            mature: mature.length,
          };
        })
        .sort((x, y) => y.spend - x.spend);
    };

    const byApproach = group((r) => (r.approach && r.approach !== "unknown" ? r.approach : undefined));
    const byMedium = group((r) => r.medium);
    const byCountry = group((r) => (r.countries.length === 1 ? r.countries[0] : undefined));

    // Тексты и версии живут только в новом нейминге — из кода, не из папки.
    const byText = group((r) => {
      const p = parseCreativeCode(r.code);
      return p.scheme === "v2" ? `${p.approach} · t${p.textNo}` : undefined;
    });
    const byVersion = group((r) => {
      const p = parseCreativeCode(r.code);
      return p.scheme === "v2" ? `v${p.version}` : undefined;
    });

    const v2 = rows.filter((r) => r.scheme === "v2").length;

    return {
      rows, spend, revenue, deps, funnel,
      byApproach, byMedium, byCountry, byText, byVersion,
      v2, v2Share: (v2 / rows.length) * 100,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-10 h-10 rounded-full border-2 border-violet-600/40 border-t-violet-400 animate-spin" />
      </div>
    );
  }
  if (!a) return <p className="text-zinc-500 text-sm py-8">За этот период считать нечего.</p>;

  const maxFunnel = Math.max(...a.funnel.map((f) => f.count), 1);

  return (
    <div className="space-y-5 pb-8">
      {/* ─── Воронка ─── */}
      <div className={card}>
        <h2 className="text-base font-bold mb-1">Воронка потерь</h2>
        <p className="text-zinc-500 text-xs mb-5">
          Первые две ступени из Meta, остальные из выгрузок Torro. Конверсия — к предыдущей ступени,
          цена — расход периода на эту ступень.
        </p>
        <div className="space-y-2.5">
          {a.funnel.map((f) => (
            <div key={f.label} className="flex items-center gap-3">
              <div className="w-40 text-xs text-zinc-400 text-right flex-shrink-0">{f.label}</div>
              <div className="flex-1 h-7 bg-violet-900/15 rounded-lg overflow-hidden relative">
                <div className="h-full bg-gradient-to-r from-violet-600/70 to-violet-500/70 rounded-lg transition-all"
                     style={{ width: `${Math.max((f.count / maxFunnel) * 100, f.count > 0 ? 1.5 : 0)}%` }} />
                <span className="absolute inset-y-0 left-3 flex items-center text-xs text-white/90 tabular-nums">
                  {int(f.count)}
                </span>
              </div>
              <div className="w-20 text-xs text-zinc-500 tabular-nums text-right">{pct(f.conv)}</div>
              <div className="w-24 text-xs text-zinc-300 tabular-nums text-right">{money(f.cost)}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-6 mt-5 pt-4 border-t border-violet-900/20 text-sm flex-wrap">
          <span className="text-zinc-500">Расход <span className="text-zinc-200">{money(a.spend)}</span></span>
          <span className="text-zinc-500">Доход <span className="text-zinc-200">{money(a.revenue)}</span></span>
          <span className="text-zinc-500">
            ROMI <span className={a.spend > 0 && a.revenue >= a.spend ? "text-green-400" : "text-zinc-200"}>
              {a.spend > 0 ? pct(((a.revenue - a.spend) / a.spend) * 100, 0) : "—"}
            </span>
          </span>
        </div>
      </div>

      {/* ─── Подходы и носители ─── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <GroupTable title="Подходы" subtitle="Цена результата и доля винеров, а не их количество" rows={a.byApproach} />
        <GroupTable title="Носители" subtitle="vid против stat на одних и тех же деньгах" rows={a.byMedium} />
      </div>

      {/* ─── Тексты и версии ─── */}
      <div className={card}>
        <h2 className="text-base font-bold mb-1">Тексты и версии</h2>
        <p className="text-zinc-500 text-xs mb-5">
          Считается только по новому неймингу — сейчас это {a.v2} из {a.rows.length} крео ({pct(a.v2Share, 0)}).
          Отвечает на вопрос, работает сам текст или конкретное исполнение.
        </p>
        {a.byText.length === 0 ? (
          <p className="text-zinc-500 text-sm">Крео нового формата за период не было.</p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <GroupTable title="По тексту" subtitle="подход и номер текста" rows={a.byText.slice(0, 12)} bare />
            <GroupTable title="По версии" subtitle="помогает ли следующая версия" rows={a.byVersion} bare />
          </div>
        )}
      </div>

      {/* ─── Страны ─── */}
      <GroupTable
        title="Страны"
        subtitle="Гео берётся из таргета адсета, а не из имени. Крео на несколько стран сюда не попадают — делить нечем"
        rows={a.byCountry}
      />
    </div>
  );
}

type GroupRow = {
  name: string; creatives: number; spend: number; pdp: number; dia: number; deps: number;
  costPdp: number | null; costDia: number | null; romi: number | null; winRate: number | null; mature: number;
};

function GroupTable({ title, subtitle, rows, bare }: { title: string; subtitle: string; rows: GroupRow[]; bare?: boolean }) {
  const body = (
    <>
      <h2 className={bare ? "text-sm font-bold mb-1" : "text-base font-bold mb-1"}>{title}</h2>
      <p className="text-zinc-500 text-xs mb-4">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="text-zinc-500 text-sm">Нет данных.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-violet-900/25">
                {["", "Крео", "Расход", "Цена ПДП", "Цена диа", "Деп", "ROMI", "Винеры"].map((h, i) => (
                  <th key={h + i} className={`py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap ${i === 0 ? "text-left" : "text-right px-2"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-violet-900/15">
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="py-2 text-zinc-200 max-w-[180px] truncate" title={r.name}>{r.name}</td>
                  <td className="py-2 px-2 text-right text-zinc-500 tabular-nums">{r.creatives}</td>
                  <td className="py-2 px-2 text-right text-zinc-200 tabular-nums">{money(r.spend)}</td>
                  <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{money(r.costPdp)}</td>
                  <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{money(r.costDia)}</td>
                  <td className="py-2 px-2 text-right text-zinc-400 tabular-nums">{r.deps}</td>
                  <td className={`py-2 px-2 text-right tabular-nums ${(r.romi ?? -1) >= 0 ? "text-green-400" : "text-zinc-400"}`}>
                    {r.romi === null ? "—" : pct(r.romi, 0)}
                  </td>
                  {/* Доля винеров среди зрелых. Незрелых меньше $200 не судим вовсе. */}
                  <td className="py-2 px-2 text-right text-zinc-400 tabular-nums" title={`Зрелых крео (от $${MATURE}): ${r.mature}`}>
                    {r.winRate === null ? "—" : pct(r.winRate, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
  return bare ? <div>{body}</div> : <div className={card}>{body}</div>;
}
