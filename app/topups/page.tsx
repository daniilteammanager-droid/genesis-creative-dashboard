import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import { CATEGORIES, NETWORKS } from "@/lib/topups/requests";
import Topups from "./Topups";

export default async function TopupsPage() {
  const me = await getProfile();
  if (!me) redirect("/login");
  return <Topups categories={CATEGORIES} networks={NETWORKS} />;
}
