"use client";

import { useState } from "react";
import Link from "next/link";

const AMOUNTS = [50, 100, 300, 500];

export default function SupportPage() {
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [showQr, setShowQr] = useState(false);

  const finalAmount = customAmount ? Number(customAmount) : amount;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #1a0f1e 0%, #0d0a12 100%)",
      color: "#fff",
      padding: "24px 20px",
      maxWidth: 560,
      margin: "0 auto",
    }}>
      <Link href="/" style={{ color: "#f97362", textDecoration: "none", fontSize: 14 }}>
        ← 回首頁
      </Link>

      <h1 style={{ fontSize: 28, margin: "24px 0 8px" }}>支持 HerLink</h1>
      <p style={{ color: "#b8b3bd", lineHeight: 1.8, fontSize: 15 }}>
        HerLink 是免費的，由站長一個人維護。
        伺服器、資料庫這些每個月都要錢。
        如果你覺得好用，歡迎隨喜支持——多少都好，心意最重要。
      </p>

      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>選擇金額</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {AMOUNTS.map((a) => (
            <button
              key={a}
              onClick={() => { setAmount(a); setCustomAmount(""); setShowQr(false); }}
              style={{
                padding: "16px",
                borderRadius: 14,
                border: amount === a && !customAmount ? "2px solid #f97362" : "1px solid rgba(255,255,255,.14)",
                background: amount === a && !customAmount ? "rgba(249,115,98,.12)" : "transparent",
                color: "#fff",
                fontSize: 18,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              NT$ {a}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <input
            type="number"
            min="1"
            placeholder="自訂金額"
            value={customAmount}
            onChange={(e) => { setCustomAmount(e.target.value); setAmount(null); setShowQr(false); }}
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,.14)",
              background: "rgba(255,255,255,.05)",
              color: "#fff",
              fontSize: 16,
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      {finalAmount > 0 && (
        <div style={{ marginTop: 24 }}>
          <button
            onClick={() => setShowQr(true)}
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: 14,
              border: "none",
              background: "#f97362",
              color: "#1a0f0a",
              fontSize: 17,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            用LINE Pay 贊助 NT$ {finalAmount}
          </button>
        </div>
      )}

      {showQr && finalAmount > 0 && (
        <div style={{
          marginTop: 24,
          padding: 24,
          borderRadius: 20,
          background: "rgba(255,255,255,.06)",
          border: "1px solid rgba(255,255,255,.1)",
          textAlign: "center",
        }}>
          <h3 style={{ fontSize: 18, margin: "0 0 8px" }}>掃碼贊助 NT$ {finalAmount}</h3>
          <p style={{ color: "#b8b3bd", fontSize: 14, margin: "0 0 16px" }}>
            打開 LINE App 掃碼轉帳
          </p>
          {/* LINE Pay QR code 放在 public/linepay-qr.png */}
          <img
            src="/linepay-qr.png"
            alt="LINE Pay 收款碼"
            style={{
              width: 240,
              height: 240,
              borderRadius: 12,
              background: "#fff",
              padding: 8,
            }}
          />
          <p style={{ color: "#b8b3bd", fontSize: 13, marginTop: 16, lineHeight: 1.7 }}>
            轉帳後不用特別通知，站長會看到。<br />
            真的很謝謝你 🙏
          </p>
        </div>
      )}

      <div style={{ marginTop: 40, padding: "16px", borderRadius: 12, background: "rgba(255,255,255,.04)" }}>
        <p style={{ color: "#8a858e", fontSize: 13, lineHeight: 1.8, margin: 0 }}>
          ※ 贊助是自願的，不影響任何功能。<br />
          ※ 贊助款用於支付 Supabase、Vercel 等營運費用。<br />
          ※ 如有問題請透過站長信箱聯繫。
        </p>
      </div>
    </div>
  );
}
