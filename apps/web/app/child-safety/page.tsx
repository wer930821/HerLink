import { Button, PageHero, Surface } from "../../components/ui";

export default function ChildSafetyPage() {
  return (
    <main className="stack">
      <PageHero
        kicker="法律文件"
        title="兒童安全標準"
        description="HerLink 對兒少性虐待及剝削內容的防範標準。"
      />

      <Surface elevation={1}>
        <div className="title">我們的立場</div>
        <p className="hero-copy">
          HerLink 對兒少性虐待及剝削（CSAM／CSAE）內容採取零容忍政策。
          任何涉及未成年人的性內容、性化內容、誘拐或剝削行為，在 HerLink
          都是被禁止的。18 歲以下不得使用 HerLink。
        </p>
      </Surface>

      <Surface elevation={1}>
        <div className="title">如何檢舉</div>
        <ol>
          <li style={{ marginBottom: 12 }}>
            在 App 內聊天室使用「檢舉」功能，直接檢舉該使用者或內容。
          </li>
          <li>
            或透過 App 內「信箱」聯絡站長，說明檢舉對象與事由。
          </li>
        </ol>
      </Surface>

      <Surface elevation={1}>
        <div className="title">我們會怎麼處理</div>
        <ul>
          <li style={{ marginBottom: 12 }}>
            接獲檢舉後，站長會審查相關內容與帳號。
          </li>
          <li style={{ marginBottom: 12 }}>
            經確認違規的內容會被移除，相關帳號會被停權。
          </li>
          <li>
            涉及兒少性虐待及剝削的違規行為，會依法向主管機關通報。
          </li>
        </ul>
        <div className="link-row link-row-spaced">
          <Button variant="link" href="/">
            返回首頁
          </Button>
          <Button variant="link" href="/safety">
            使用安全守則
          </Button>
          <Button variant="link" href="/privacy">
            隱私權政策
          </Button>
        </div>
      </Surface>
    </main>
  );
}
