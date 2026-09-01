import { Button, PageHero, Surface } from "../components/ui";

export default function NotFound() {
  return (
    <main className="stack">
      <PageHero
        kicker="404"
        title="頁面不存在"
        description="你造訪的頁面可能已經移除，或網址有誤。"
        actions={<Button size="lg" href="/">返回首頁</Button>}
      />
      <Surface elevation={1}>
        <p className="hero-copy">如果你認為這是系統問題，請回到首頁重新開始。</p>
      </Surface>
    </main>
  );
}
