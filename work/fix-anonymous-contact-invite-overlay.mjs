import fs from "node:fs";

const clientPath = "apps/web/app/session/[id]/RandomSessionClient.tsx";
let client = fs.readFileSync(clientPath, "utf8");
const oldCard = `  const contactRequestCard =
    contactState?.status !== "active" && contactState?.partner_approved && !contactState.my_approved ? (
      <section className="notice" style={{ margin: "12px 16px" }}>
        <strong>{partnerName} 想和你成為匿名聯絡人</strong>
        <div className="muted small" style={{ marginTop: 6 }}>雙方都同意後，之後可以從「匿名聯絡人」再次找到彼此。</div>
        <div className="row" style={{ marginTop: 10 }}>
          <Button size="sm" type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void handleAnonymousContact(); }} disabled={contactBusy}>
            {contactBusy ? "處理中…" : "同意"}
          </Button>
        </div>
      </section>
    ) : null;
`;
const newCard = `  const contactRequestCard =
    contactState?.status !== "active" && contactState?.partner_approved && !contactState.my_approved ? (
      <div className="anonymous-contact-invite-overlay" role="presentation">
        <section className="notice anonymous-contact-invite-card" role="dialog" aria-modal="false" aria-label="匿名聯絡人邀請">
          <strong>{partnerName} 想和你成為匿名聯絡人</strong>
          <div className="muted small" style={{ marginTop: 6 }}>雙方都同意後，之後可以從「匿名聯絡人」再次找到彼此。</div>
          <div className="row" style={{ marginTop: 10 }}>
            <Button size="sm" type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void handleAnonymousContact(); }} disabled={contactBusy}>
              {contactBusy ? "處理中…" : "同意"}
            </Button>
          </div>
        </section>
      </div>
    ) : null;
`;
if (!client.includes(oldCard)) throw new Error("Expected contact request card block not found");
client = client.replace(oldCard, newCard);

const oldStack = `        {(contactRequestCard || notice) ? (
          <div className="chat-status-stack">
            {contactRequestCard}
            {notice ? <div className="notice chat-status-notice">{notice}</div> : null}
          </div>
        ) : null}
`;
const newStack = `        {contactRequestCard}
        {notice ? (
          <div className="chat-status-stack">
            <div className="notice chat-status-notice">{notice}</div>
          </div>
        ) : null}
`;
if (!client.includes(oldStack)) throw new Error("Expected chat status stack block not found");
client = client.replace(oldStack, newStack);
fs.writeFileSync(clientPath, client);

const cssPath = "apps/web/app/globals.css";
let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* Anonymous contact invite must stay tappable above the scrolling message layer. */";
if (!css.includes(marker)) {
  css += `\n\n${marker}
.anonymous-contact-invite-overlay {
  position: fixed;
  inset: calc(env(safe-area-inset-top) + 72px) 0 auto;
  z-index: 1200;
  display: flex;
  justify-content: center;
  padding: 0 16px;
  pointer-events: none;
}

.anonymous-contact-invite-card {
  width: min(100%, 688px);
  margin: 0;
  pointer-events: auto;
  background: color-mix(in srgb, var(--color-surface-1) 96%, transparent);
  border-color: color-mix(in srgb, var(--color-accent) 34%, var(--color-border));
  box-shadow: var(--shadow-floating);
}

@media (max-width: 720px) {
  .anonymous-contact-invite-overlay {
    inset: calc(env(safe-area-inset-top) + 64px) 0 auto;
    padding: 0 12px;
  }
}
`;
  fs.writeFileSync(cssPath, css);
}
