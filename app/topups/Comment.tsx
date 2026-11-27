import { blocksOf, linksOf } from "@/lib/topups/comment";

// Комментарий заявки на странице: строки — абзацы, «- пункт» — список, ссылки кликаются. Разбор — lib/topups/comment.ts,
// тот же, что у сообщения в платёжном чате.

function Line({ text }: { text: string }) {
  return (
    <>
      {linksOf(text).map((p, i) => p.href
        ? <a key={i} href={p.href} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline break-all">{p.text}</a>
        : <span key={i}>{p.text}</span>)}
    </>
  );
}

export default function Comment({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`space-y-1 break-words ${className}`}>
      {blocksOf(text).map((b, i) => b.kind === "p" ? <p key={i}><Line text={b.text} /></p>
        : b.kind === "ul" ? <ul key={i} className="list-disc pl-5 space-y-0.5">{b.items.map((x, j) => <li key={j}><Line text={x} /></li>)}</ul>
        : <ol key={i} start={b.start} className="list-decimal pl-5 space-y-0.5">{b.items.map((x, j) => <li key={j}><Line text={x} /></li>)}</ol>)}
    </div>
  );
}
