import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import { NETWORK_NAMES, PAIRS } from "@/lib/topups/chain";
import { CATEGORIES } from "@/lib/topups/requests";
import Topups from "./Topups";

export default async function TopupsPage() {
  const me = await getProfile();
  if (!me) redirect("/login");
  return <Topups categories={CATEGORIES} pairs={PAIRS} networks={NETWORK_NAMES} />;
}
