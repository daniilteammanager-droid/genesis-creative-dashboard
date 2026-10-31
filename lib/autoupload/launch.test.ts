// Самопроверка загрузки видео кусками. Сеть подменена: Meta (resumable upload) и R2 (Range)
// отвечают как в жизни. Запуск: npx tsx lib/autoupload/launch.test.ts
import assert from "node:assert/strict";
import { ensureMedia, type JobState } from "./launch";

const SIZE = 20;                         // «видео» в 20 байт, Meta режет по 8
const file = Buffer.from("abcdefghijklmnopqrst");
const got: string[] = [];                // куски, которые дошли до Meta
let failOnce = true;                     // второй кусок в первый раз обрывается таймаутом

globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("r2.example")) {
    const [from, to] = String((init?.headers as Record<string, string>)?.Range).replace("bytes=", "").split("-").map(Number);
    return new Response(file.subarray(from, to + 1), { status: 206 });
  }
  const form = init?.body instanceof FormData ? init.body : null;
  if (form?.get("upload_phase") === "transfer") {
    const at = Number(form.get("start_offset"));
    if (at === 8 && failOnce) { failOnce = false; throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }
    got.push(Buffer.from(await (form.get("video_file_chunk") as Blob).arrayBuffer()).toString());
    const next = Math.min(at + 8, SIZE);
    return Response.json({ start_offset: String(next), end_offset: String(Math.min(next + 8, SIZE)) });
  }
  const params = new URLSearchParams(typeof init?.body === "string" || init?.body instanceof URLSearchParams ? String(init.body) : url.split("?")[1] ?? "");
  if (params.get("upload_phase") === "finish") return params.get("upload_session_id") === "s3"
    ? Response.json({ error: { message: "session already finished", code: 100 } }, { status: 400 })
    : Response.json({ success: true });
  if (url.includes("/vid3?") && url.includes("fields=id&")) return Response.json({ id: "vid3" });
  if (url.includes("/vid3?")) return Response.json({ status: { video_status: "ready" } });
  if (url.includes("/thumbnails")) return Response.json({ data: [{ uri: "https://thumb", is_preferred: true }] });
  if (url.includes("/vid1?")) return Response.json({ status: { video_status: "ready" } });
  return Response.json({ error: { message: `не ждали ${url}` } }, { status: 400 });
}) as typeof fetch;
process.env.R2_PUBLIC_URL = "https://r2.example";

const state: JobState = {
  created: [], accounts: {},
  media: { "1|b2/v.mp4": { type: "video", id: "vid1", ready: false, upload: { session: "s1", src: "originals/b2/v.mov", offset: 0, end: 8, size: SIZE } } },
};
const said: string[] = [];
const say = async (s: string) => { said.push(s); };

(async () => {
// Первый проход: кусок 0–8 ушёл, на втором — таймаут. Задание не падает навсегда: ошибка временная.
await assert.rejects(ensureMedia("t", "1", "b2/v.mp4", "video", "v", state, Date.now() + 60_000, say), (e: Error & { transient?: boolean }) => e.transient === true);
assert.equal(state.media["1|b2/v.mp4"].upload?.offset, 8);    // место загрузки сохранено
// Второй проход докачивает с того же места, завершает загрузку и ждёт готовности видео.
const m = await ensureMedia("t", "1", "b2/v.mp4", "video", "v", state, Date.now() + 60_000, say);
assert.equal(got.join(""), file.toString());                    // все куски, по порядку, без повторов
assert.equal(m?.ready, true);
assert.equal(m?.imageUrl, "https://thumb");
assert.equal(m?.upload, undefined);
assert.deepEqual(said, ["Загружаю v: 40%", "Загружаю v: 80%", "Загружаю v: 100%"]);
// Дедлайн прохода вышел — ничего не грузим, null: докачает следующий проход.
state.media["1|x"] = { type: "video", id: "vid2", ready: false, upload: { session: "s2", src: "x", offset: 0, end: 0, size: SIZE } };
assert.equal(await ensureMedia("t", "1", "x", "video", "x", state, Date.now() - 1, say), null);

// Повторный finish (ответ на первый оборвался): Meta отказывает, но видео есть — идём дальше.
state.media["1|y"] = { type: "video", id: "vid3", ready: false, upload: { session: "s3", src: "y", offset: SIZE, end: 0, size: SIZE } };
assert.equal((await ensureMedia("t", "1", "y", "video", "y", state, Date.now() + 60_000, say))?.ready, true);

console.log("launch: ok");
})();
