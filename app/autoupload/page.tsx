import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import Autoupload from "./Autoupload";

export default async function AutouploadPage() {
  const me = await getProfile();
  if (!me) redirect("/login");
  return <Autoupload />;
}
