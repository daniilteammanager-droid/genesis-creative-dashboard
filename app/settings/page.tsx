import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/server";
import ProfileSettings from "./ProfileSettings";

export default async function SettingsProfilePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return <ProfileSettings profile={profile} />;
}
