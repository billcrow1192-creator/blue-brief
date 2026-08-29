import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BLUE BRIEF｜海洋情報・意思決定リハーサル",
  description: "海洋センサー情報の要約が、防災・港湾・救助の判断へ与える連鎖を検証する意思決定シミュレーター。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
