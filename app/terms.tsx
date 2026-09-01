import { PolicyScreen } from "../components/PolicyScreen";

export default function TermsScreen() {
  return (
    <PolicyScreen
      eyebrow="Terms"
      title="HerLink Beta Terms"
      subtitle="這份條款說明 Beta 測試期間的基本使用規則、限制與風險告知。"
      notice="這是 Beta 版本條款，不代表最終正式版法律文件，也不保證所有條文已完成外部法律審閱。"
      sections={[
        {
          title: "社群資格與年齡限制",
          body: "HerLink 僅供符合社群資格的成年人使用。未成年人不得使用；若系統或 moderation 發現資格不符、冒用或詐騙風險，帳號可能被限制、審核或停用。",
        },
        {
          title: "妳對內容負責",
          body: "妳需要對自己的 profile、照片、訊息與檢舉行為負責，不得冒充他人、散布騷擾內容、索取金錢、投資詐騙、要求 OTP 或其他敏感資訊。",
        },
        {
          title: "驗證與安全限制",
          body: "真人驗證能提高可信度，但不代表 HerLink 保證每位使用者的身份絕對真實。請仍保留基本警覺，避免離站轉帳、交付驗證碼或進入外部投資群組。",
        },
        {
          title: "帳號限制與刪除",
          body: "HerLink 可依風險事件、檢舉、moderation 判定或 Beta 穩定性需要，對帳號進行 under review、suspended、deletion pending 等限制。",
        },
        {
          title: "Beta 服務狀態",
          body: "Beta 期間服務可能中斷、調整、回收或資料重整。請不要把 HerLink 視為不可中斷的商業級正式服務。",
        },
      ]}
    />
  );
}
