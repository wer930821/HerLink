"use client";

import { useMemo, useState } from "react";
import { buildSupportConfirmation, normalizeSupportAmount } from "./support-flow";

const supportAmounts = [
  { amount: 30, label: "給 HerLink 一點電力" },
  { amount: 50, label: "請站長喝杯飲料" },
  { amount: 100, label: "支持網站繼續長大" },
  { amount: 300, label: "大力支持 HerLink" },
];

export default function SupportCheckout() {
  const [selectedAmount, setSelectedAmount] = useState<number | "custom">(50);
  const [customAmount, setCustomAmount] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);

  const amount = useMemo(
    () => normalizeSupportAmount(selectedAmount === "custom" ? customAmount : selectedAmount),
    [customAmount, selectedAmount],
  );
  const confirmation = amount === null ? null : buildSupportConfirmation(amount, message);

  if (confirming && confirmation) {
    return (
      <section className="support-section support-checkout" aria-labelledby="support-confirm-title">
        <p className="support-step">確認支持內容</p>
        <h2 id="support-confirm-title">匿名支持 NT${confirmation.amount}</h2>
        <div className="support-confirm-summary">
          <div><span>支持金額</span><strong>NT${confirmation.amount}</strong></div>
          <div><span>支持方式</span><strong>匿名</strong></div>
          <div><span>留言</span><strong>{confirmation.message || "未填寫"}</strong></div>
        </div>
        <p className="support-muted">
          HerLink 不會把這筆支持與匿名暱稱、聊天室、恢復碼或配對紀錄建立關聯。
        </p>
        <button type="button" className="support-pay-button" disabled>
          金流審核完成後開放付款
        </button>
        <button type="button" className="support-text-button" onClick={() => setConfirming(false)}>
          返回修改
        </button>
      </section>
    );
  }

  return (
    <section className="support-section support-checkout" aria-labelledby="support-amount-title">
      <p className="support-step">選擇支持方式</p>
      <h2 id="support-amount-title">支持 HerLink</h2>
      <p className="support-muted">選一個金額即可。付款功能會在金流審核完成後開放。</p>

      <div className="support-amount-grid">
        {supportAmounts.map(({ amount: option, label }) => (
          <button
            key={option}
            type="button"
            className={`support-amount${selectedAmount === option ? " selected" : ""}`}
            aria-pressed={selectedAmount === option}
            onClick={() => setSelectedAmount(option)}
          >
            <strong>NT${option}</strong>
            <span>{label}</span>
          </button>
        ))}
        <button
          type="button"
          className={`support-amount support-amount-custom${selectedAmount === "custom" ? " selected" : ""}`}
          aria-pressed={selectedAmount === "custom"}
          onClick={() => setSelectedAmount("custom")}
        >
          <strong>自訂金額</strong>
          <span>依你的心意支持</span>
        </button>
      </div>

      {selectedAmount === "custom" && (
        <label className="support-field">
          <span>自訂金額（NT$1～100,000）</span>
          <input
            type="number"
            min="1"
            max="100000"
            inputMode="numeric"
            value={customAmount}
            onChange={(event) => setCustomAmount(event.target.value)}
            placeholder="輸入金額"
          />
        </label>
      )}

      <label className="support-field">
        <span>想對 HerLink 說的話（選填）</span>
        <textarea
          maxLength={100}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="最多 100 字，不需要留下暱稱或聯絡資料"
        />
        <small>{message.length}/100</small>
      </label>

      <div className="support-anonymous-note">
        <strong>預設匿名</strong>
        <span>不需要填 HerLink 暱稱、聊天室資訊或恢復碼。</span>
      </div>

      <button
        type="button"
        className="support-primary-button"
        disabled={amount === null}
        onClick={() => setConfirming(true)}
      >
        確認支持內容{amount ? ` · NT$${amount}` : ""}
      </button>
    </section>
  );
}
