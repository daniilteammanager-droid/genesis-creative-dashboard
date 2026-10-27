import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import Uniquify from "./Uniquify";

export default async function UniquifyPage() {
  const me = await getProfile();
  if (!me) redirect("/login");
  return <Uniquify />;
}
