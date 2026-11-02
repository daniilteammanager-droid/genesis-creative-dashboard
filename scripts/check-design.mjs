#!/usr/bin/env node
// Проверка правил дизайна (AGENTS.md → UI Rules). Ловит то, чем новые блоки
// расползаются от дизайн-системы: hex вместо токена, старые рамки и серые
// подписи, свой календарь, свой спиннер, px-брейкпоинт, эмодзи вместо иконки.
//
//   node scripts/check-design.mjs            — все .tsx в app/ и components/
//   node scripts/check-design.mjs a.tsx b.tsx — только эти файлы
//   node scripts/check-design.mjs --hook     — хук Claude Code: путь из JSON на stdin,
//                                              нарушения в stderr и код 2, чтобы Claude их поправил
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const RULES = [
  [/\b(?:bg|text|border|from|via|to|ring|outline|fill|stroke|shadow|divide|decoration|placeholder|caret|accent)-\[#/,
    "цвет — токен из globals.css: bg-background / bg-panel / bg-card / bg-raised, border-line"],
  [/\bborder-violet-9\d\d\b/, "рамка — border-line (у поля и кнопки — border-line-strong)"],
  [/\btext-zinc-(?:500|600)\b/, "подпись — text-hint"],
  [/type=["']date["']/, "дата — DateRange / DatePicker из components/DatePicker.tsx"],
  [/\banimate-spin\b/, "загрузка — <Spinner> / <Busy> из components/ui.tsx", ["components/ui.tsx"]],
  [/\b(?:min|max)-\[\d+px\]:/, "брейкпоинт в rem (min-[106.25rem]:), в px он молча не срабатывает"],
  [/<h1\b(?![^>]*page-title)/, "заголовок страницы — <h1 className=\"page-title\">"],
  [/[\u{1F300}-\u{1FAFF}]/u, "иконка — <Icon name=…> из components/ui.tsx, не эмодзи",
    ["app/library/CreativeUploadModal.tsx"]], // грамота за 5+ крео — шутка в своём стиле, с эмодзи нарочно
];

const isComment = (line) => /^\s*(\/\/|\/\*|\*|\{\s*\/\*)/.test(line);

function check(file) {
  const rel = relative(ROOT, file);
  const out = [];
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (isComment(line)) return;
    for (const [re, msg, allow] of RULES) {
      if (allow?.includes(rel) || !re.test(line)) continue;
      out.push(`${rel}:${i + 1}: ${msg}\n    ${line.trim().slice(0, 140)}`);
    }
  });
  return out;
}

const inScope = (rel) => /^(app|components)\//.test(rel) && rel.endsWith(".tsx");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

const args = process.argv.slice(2);
const hook = args[0] === "--hook";
let files;
if (hook) {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const path = input.tool_response?.filePath ?? input.tool_input?.file_path;
  files = path && inScope(relative(ROOT, resolve(path))) ? [resolve(path)] : [];
} else {
  files = args.length ? args.map((a) => resolve(a)) : ["app", "components"].flatMap((d) => walk(join(ROOT, d)));
}

const problems = files.flatMap(check);
if (problems.length === 0) process.exit(0);

const text = `Правила дизайна (AGENTS.md → UI Rules) нарушены — поправь:\n${problems.join("\n")}`;
if (hook) {
  console.error(text);
  process.exit(2);
}
console.log(text);
process.exit(1);
