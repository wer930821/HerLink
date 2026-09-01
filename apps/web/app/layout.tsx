import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HerLink Web V0.1",
  description: "純匿名隨機配對網站 + 即時聊天 + 防詐騙",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要內容
        </a>
        <div className="shell">
          <div className="container" id="main-content">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
