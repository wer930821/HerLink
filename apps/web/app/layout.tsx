import "./globals.css";
import type { Metadata, Viewport } from "next";
import { SiteChrome } from "../components/layout/SiteChrome";
import { SessionReadTracker } from "../components/chat/SessionReadTracker";
import { FormalAccountBinding } from "./formal-account-binding";

export const metadata: Metadata = { title: "HerLink", description: "匿名聊天" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-Hant"><body><SessionReadTracker /><SiteChrome /><div className="app-shell"><div className="app-container">{children}</div></div><FormalAccountBinding /></body></html>; }
