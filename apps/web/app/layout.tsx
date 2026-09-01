import "./globals.css";
import type { Metadata, Viewport } from "next";
import { SiteChrome } from "../components/layout/SiteChrome";

export const metadata: Metadata = {
  title: "HerLink Web V0.1",
  description: "純匿名隨機配對網站 + 即時聊天 + 防詐騙",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0b16",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要內容
        </a>
        <SiteChrome>
          <div className="shell">
            <div className="container" id="main-content">
              {children}
            </div>
          </div>
        </SiteChrome>
      </body>
    </html>
  );
}
