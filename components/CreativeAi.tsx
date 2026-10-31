"use client";

import { useEffect, useState } from "react";
import { AiCreo } from "@/app/traffic-report/AiPanel";
import { seg } from "./ui";

// AI-разбор в модалке крео (Decision 101): тот же разбор «баер × крео», что ✦ в «Отчётах».
// Баеру — свой; владельцу и тимлиду — переключатель по баерам, у кого крео крутилось за
// 30 дней или уже разобрано. AI не подключён — блока нет. Другое крео — монтировать заново (key).

type Who = { id: string; label: string; creo: string };

export default function CreativeAi({ code }: { code: string }) {
  const [who, setWho] = useState<Who[] | null>(null);   // null — грузится или AI не подключён
  const [pick, setPick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ai/creo?${new URLSearchParams({ creo: code, who: "1" })}`).then((r) => r.json())
      .then((j) => { if (alive && j.ready) setWho(j.buyers ?? []); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [code]);

  if (who === null) return null;
  const b = who[pick];
  return (
    <section className="card rounded-xl p-4 mb-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="label flex-1">✦ AI-разбор · 30 дней</h3>
        {who.length > 1 && (
          <div className="seg">{who.map((w, i) => <button key={w.id} onClick={() => setPick(i)} {...seg(i === pick)}>{w.label}</button>)}</div>
        )}
      </div>
      {b ? <AiCreo key={b.id} buyerId={b.id} creo={b.creo} compact />
        : <p className="text-sm text-hint">За 30 дней по этому крео нет цифр в Отчётах — разбирать нечего.</p>}
    </section>
  );
}
