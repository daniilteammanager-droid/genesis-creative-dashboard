import Anthropic from "@anthropic-ai/sdk";

// Вызов Claude для AI-разборов (Decision 101). Ключ — ANTHROPIC_API_KEY из организации Console,
// привязанной к месячным API-кредитам подписки. Нет ключа — разборы выключены, остальное работает.

export const CREO_MODEL = "claude-opus-5-5";        // разбор одного крео
export const SUMMARY_MODEL = "claude-fable-5-1";    // недельная сводка по баерам и команде

// $ за 1M токенов (вход, выход) — для учёта лимита баера. Отказ модели уводит запрос на
// запасную модель (fallbacks: "default"), её цены нет в таблице — считаем по запрошенной.
const PRICE: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20], "claude-fable-5-1": [10, 50], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5],
};

export const aiReady = () => Boolean(process.env.ANTHROPIC_API_KEY);

export interface Answer { text: string; model: string; inputTokens: number; outputTokens: number; cost: number }

let client: Anthropic | null = null;

export async function ask(model: string, system: string, user: string, maxTokens = 8000): Promise<Answer> {
  if (!aiReady()) throw new Error("AI-разборы не подключены: нет ANTHROPIC_API_KEY");
  client ??= new Anthropic();
  const r = await client.beta.messages.create({
    model, max_tokens: maxTokens, system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (r.stop_reason === "refusal") throw new Error("Модель отказалась отвечать на этот запрос");
  const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
  if (!text) throw new Error("Модель вернула пустой ответ");
  const [pi, po] = PRICE[r.model] ?? PRICE[model] ?? [10, 50];
  const { input_tokens: inputTokens, output_tokens: outputTokens } = r.usage;
  return { text, model: r.model, inputTokens, outputTokens, cost: (inputTokens * pi + outputTokens * po) / 1e6 };
}
