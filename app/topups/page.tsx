import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import { NETWORK_NAMES, PAIRS } from "@/lib/topups/chain";
import Topups from "./Topups";

// Категории, кошельки и шаблоны приходят с заявками (GET /api/topups): владелец меняет их на вкладке «Настройки».
export default async function TopupsPage() {
  const me = await getProfile();
  if (!me) redirect("/login");
  return <Topups pairs={PAIRS} networks={NETWORK_NAMES} />;
}
