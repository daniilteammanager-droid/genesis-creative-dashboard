import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Ключ Meta умеет тратить деньги, поэтому в базе он лежит шифротекстом.
// AES-256-GCM, а не просто AES: GCM проверяет целостность, и подменённый или
// побитый шифротекст не расшифруется в мусор молча, а честно упадёт.

function key(): Buffer {
  const secret = process.env.CONNECTIONS_SECRET;
  if (!secret || secret.length < 16) {
    // Отсутствие обязательной переменной — явная ошибка, а не тихое сохранение
    // токена открытым текстом.
    throw new Error(
      "Не задан CONNECTIONS_SECRET (нужна строка от 16 символов) — без него ключ Meta негде хранить"
    );
  }
  // sha256 приводит секрет любой длины к нужным 32 байтам.
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  // Версия в начале: если однажды сменится алгоритм, старые записи будет по чему отличить.
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, ivB64, tagB64, ctB64] = stored.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Шифротекст неизвестного формата");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// Хвост ключа, чтобы человек узнал свой, не читая его целиком.
export function secretHint(plain: string): string {
  return plain.length <= 4 ? "…" : `…${plain.slice(-4)}`;
}
