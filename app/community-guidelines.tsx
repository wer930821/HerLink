import { PolicyScreen } from "../components/PolicyScreen";

export default function CommunityGuidelinesScreen() {
  return (
    <PolicyScreen
      eyebrow="Community"
      title="HerLink Community Guidelines"
      subtitle="我們希望 HerLink 在 Beta 期間就把界線說清楚：真誠、尊重、安全。"
      notice="若內容涉及騷擾、詐騙、冒用、資格不符或未成年人風險，HerLink 可能立即限制互動並進入 moderation 流程。"
      sections={[
        {
          title: "真誠與身份",
          body: "請使用真實且與社群資格相符的資料，不要冒用他人照片、假扮他人身份，或刻意規避驗證與安全流程。",
        },
        {
          title: "禁止騷擾與仇恨內容",
          body: "不允許性騷擾、威脅、羞辱、仇恨言論、跟蹤、反覆施壓或未經同意的露骨內容。",
        },
        {
          title: "禁止詐騙與金錢索取",
          body: "不允許要求匯款、投資、虛擬貨幣操作、OTP、密碼、銀行資訊，或引導到高風險外部平台進行詐騙。",
        },
        {
          title: "照片與驗證規則",
          body: "公開照片必須屬於妳本人，驗證素材僅用於驗證與審核。請不要上傳未經同意的他人照片或明顯誤導性的圖片。",
        },
        {
          title: "檢舉與封鎖",
          body: "若遇到不舒服或可疑行為，請直接使用封鎖與檢舉。惡意大量檢舉、騷擾式互動與 mass message / mass like 也會被限制。",
        },
      ]}
    />
  );
}
