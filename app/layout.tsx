import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Shell from "@/components/Shell";
import { getProfile } from "@/lib/auth/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Genesis Creative Dashboard",
  description: "Internal Creative Intelligence System for Genesis Academy",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Профиль читается здесь один раз на запрос: оболочке нужна роль, чтобы решить,
  // показывать ли служебные пункты. На странице входа профиля нет, и оболочка
  // тогда просто отдаёт содержимое как есть.
  const profile = await getProfile();

  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Shell profile={profile}>{children}</Shell>
      </body>
    </html>
  );
}
