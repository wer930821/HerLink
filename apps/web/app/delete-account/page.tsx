import { Button, PageHero, Surface } from "../../components/ui";

export default function DeleteAccountPage() {
  return (
    <main className="stack">
      <PageHero
        kicker="法律文件"
        title="刪除帳號"
        description="說明如何要求刪除 HerLink 帳號與相關資料。"
      />

      <Surface elevation={1}>
        <div className="title">如何刪除帳號</div>
        <ol>
          <li style={{ marginBottom: 12 }}>
            開啟 HerLink App，前往「安全與設定」。
          </li>
          <li style={{ marginBottom: 12 }}>
            點「刪除帳號」，再按「確認刪除」。
          </li>
          <li style={{ marginBottom: 12 }}>
            刪除完成後會自動登出，帳號與相關資料將永久刪除，且無法復原。
          </li>
          <li>
            若無法使用 App，請透過 App 內「信箱」聯絡站長，註明你的匿名名稱，站長會協助處理刪除要求。
          </li>
        </ol>
      </Surface>

      <Surface elevation={1}>
        <div className="title">會刪除的資料</div>
        <ul>
          <li style={{ marginBottom: 12 }}>登入帳號與匿名身分資料</li>
          <li style={{ marginBottom: 12 }}>個人檔案與上傳的照片</li>
          <li>與該帳號關聯的其他資料</li>
        </ul>
      </Surface>

      <Surface elevation={1}>
        <div className="title">注意事項</div>
        <ul>
          <li style={{ marginBottom: 12 }}>
            刪除是永久的，無法復原；刪除後匿名聊天室也可能無法再取回。
          </li>
          <li>
            對方裝置上已存在的對話紀錄不會因你刪除帳號而消失。
          </li>
        </ul>
        <div className="link-row link-row-spaced">
          <Button variant="link" href="/">
            返回首頁
          </Button>
          <Button variant="link" href="/privacy">
            隱私權政策
          </Button>
        </div>
      </Surface>
    </main>
  );
}
