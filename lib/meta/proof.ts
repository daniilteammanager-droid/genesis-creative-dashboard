import { createHmac } from "node:crypto";

// appsecret_proof (Decision 093): приложение с «требовать App Secret» принимает запрос, только
// если к ключу приложен HMAC-SHA256 ключа секретом приложения. Секрет есть только у ключа
// автозалива; кто его расшифровал, кладёт сюда, а запросы в Graph берут proof отсюда.
// ponytail: Map на процесс — ключ регистрируется в том же вызове, где им ходят.
const secrets = new Map<string, string>();

export function rememberSecret(token: string, secret: string | null | undefined): void {
  if (secret) secrets.set(token, secret);
}

export function proofFor(token: string): Record<string, string> {
  const s = secrets.get(token);
  return s ? { appsecret_proof: createHmac("sha256", s).update(token).digest("hex") } : {};
}
