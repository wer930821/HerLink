import "./globals.css";
import type { Metadata } from "next";
import { FormalAccountBinding } from "./formal-account-binding";

export const metadata: Metadata = {
  title: "HerLink Web V0.1",
  description: "純匿名隨機配對網站 + 即時聊天 + 防詐騙",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>
        <div className="shell">
          <div className="container">{children}</div>
        </div>
        <FormalAccountBinding />
      </body>
    </html>
  );
}
