import { PolicyScreen } from "../components/PolicyScreen";

export default function PrivacyScreen() {
  return (
    <PolicyScreen
      eyebrow="Privacy"
      title="HerLink Beta Privacy Policy"
      subtitle="這是 beta 版本的隱私說明，用來清楚說明目前產品收集、使用與保留哪些資料。"
      notice="這份文字尚未經律師正式審閱，Beta 期間可能依實際風險控管與法規需求更新。"
      sections={[
        {
          title: "我們收集哪些資料",
          body: "我們會收集帳號資料、公開 profile 內容、公開照片、驗證素材、裝置雜湊、互動紀錄、檢舉與 moderation 紀錄，以及 beta 穩定性所需的錯誤與事件紀錄。",
        },
        {
          title: "公開 profile / 照片",
          body: "Discover 與聊天只會顯示符合公開條件的 profile 與 approved 公開照片。私人驗證素材不會直接作為公開頭像，也不會在一般使用者之間流通。",
        },
        {
          title: "驗證素材與裝置資料",
          body: "驗證照片只用於真人驗證與風險審查；裝置雜湊只用於重複裝置、冒用與風險偵測，不會作為廣告追蹤用途。",
        },
        {
          title: "檢舉、Moderation 與資料保留",
          body: "檢舉內容、帳號狀態、moderation decision 與必要 audit log 可能在帳號刪除後仍保留一段合理期間，以處理濫用、詐騙與法規需求。",
        },
        {
          title: "帳號刪除與 retention",
          body: "當妳要求刪除帳號時，帳號會先進入 deletion pending 狀態，從 Discover 隱藏並停止新互動；部分安全與 audit 紀錄會依 Beta 安全需求保留。",
        },
      ]}
    />
  );
}
