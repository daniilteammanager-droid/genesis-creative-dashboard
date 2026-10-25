import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import { KINDS, NETWORKS } from "@/lib/topups/requests";
import Topups from "./Topups";

export default async function TopupsPage() {
  const me = await getProfile();
  if (!me) redirect("/login");
  return <Topups kinds={KINDS} networks={NETWORKS} />;
}
