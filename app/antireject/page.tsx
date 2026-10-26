import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import Antireject from "./Antireject";

export default async function AntirejectPage() {
  const me = await getProfile();
  if (!me) redirect("/login");
  return <Antireject />;
}
