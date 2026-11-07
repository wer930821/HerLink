"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAINTENANCE_MODE, MAINTENANCE_MESSAGE, MAINTENANCE_TITLE } from "../../lib/site-config";
import {
  findOrJoinRandomMatch,
  getCurrentSession,
  leaveRandomQueue,
  loadMyActiveRandomSession,
  loadMyProfile,
  loadMyRandomQueue,
  registerAnonymousAbuseIdentity,
  supabase,
  type RandomQueueRow,
  type RandomSessionRow,
} from "../../lib/supabase";
import { Button, Notice, PageHero } from "../../components/ui";

// 3D 小鎮最小版：只給孤星企鵝。
// Gate 寫法沿用首頁現成判斷：anonymousSummary?.name === "孤星企鵝"。
// 小鎮頁本身再驗一次身分，非孤星企鵝直接導回首頁。
const LONELY_STAR_NAME = "孤星企鵝";
const PAVILION = { x: 0, z: -14, radius: 4.5 };
const FOUNTAIN_RADIUS = 3.4;
const TOWN_BOUND = 22;
const WAITING_FALLBACK_POLL_MS = 60_000;

type GateState = "loading" | "allowed" | "denied";

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function TownPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const posRef = useRef({ x: 0, z: 18 });
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const keysRef = useRef<Set<string>>(new Set());
  const scenicRef = useRef(false);
  const nearPavilionRef = useRef(false);
  const matchInFlightRef = useRef(false);
  const waitingRealtimeHealthyRef = useRef(false);
  const navigatingRef = useRef(false);

  const [gate, setGate] = useState<GateState>("loading");
  const [userId, setUserId] = useState<string | null>(null);
  const [queue, setQueue] = useState<RandomQueueRow | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [waitingCount, setWaitingCount] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [nearPavilion, setNearPavilion] = useState(false);
  const [scenic, setScenic] = useState(false);

  // Gate：沿用目前匿名登入 session，不重新登入、不建新身分。
  // 沒 session 或名字不是孤星企鵝，一律導回首頁，畫布不會先渲染。
  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        const { data } = await getCurrentSession();
        const session = data.session ?? null;
        if (!session) {
          router.replace("/");
          return;
        }
        const profileResult = await loadMyProfile(session.user.id);
        if (!mounted) return;
        if (profileResult.data?.anonymous_display_name !== LONELY_STAR_NAME) {
          setGate("denied");
          router.replace("/");
          return;
        }
        setUserId(session.user.id);
        setGate("allowed");
        const queueResult = await loadMyRandomQueue(session.user.id);
        if (!mounted) return;
        if (queueResult.data?.status === "waiting") {
          setQueue(queueResult.data);
          setWaiting(true);
        }
      } catch {
        if (mounted) router.replace("/");
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [router]);

  // 等待人數：沿用 /api/public/match-status（內部呼叫 get_public_waiting_count）。
  useEffect(() => {
    if (gate !== "allowed") return;
    let mounted = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/public/match-status?t=${Date.now()}`);
        const payload = (await response.json()) as { waiting?: number };
        if (mounted) setWaitingCount(Number(payload.waiting ?? 0));
      } catch {
        // 人數拿不到不擋配對，維持上一筆數字。
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), WAITING_FALLBACK_POLL_MS);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [gate]);

  // 配對狀態：沿用等候頁同一套 Realtime 訂閱，斷線 60 秒輪詢備援。
  // 配對到就照現有流程走 /waiting?matched=<session_id>，再由等候頁跳聊天室；
  // 已有 active session 且不在等待時，直接跳 /session/<id>。
  useEffect(() => {
    if (gate !== "allowed" || !userId || !waiting) return;
    let mounted = true;
    let syncing = false;
    const syncMatchState = async () => {
      if (!mounted || syncing || navigatingRef.current) return;
      syncing = true;
      try {
        const [queueResult, sessionResult] = await Promise.all([
          loadMyRandomQueue(userId),
          loadMyActiveRandomSession(),
        ]);
        if (!mounted) return;
        if (!queueResult.error) setQueue(queueResult.data ?? null);
        const matchedSessionId =
          queueResult.data?.status === "matched" ? queueResult.data.matched_session_id : null;
        if (matchedSessionId) {
          navigatingRef.current = true;
          router.replace(`/waiting?matched=${encodeURIComponent(matchedSessionId)}`);
          return;
        }
        if (sessionResult.data?.id && queueResult.data?.status !== "waiting") {
          navigatingRef.current = true;
          router.replace(`/session/${sessionResult.data.id}`);
        }
      } finally {
        syncing = false;
      }
    };

    waitingRealtimeHealthyRef.current = false;
    const realtime = supabase
      .channel(`town-match-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "random_match_queue" }, () => void syncMatchState())
      .on("postgres_changes", { event: "*", schema: "public", table: "random_chat_sessions" }, () => void syncMatchState())
      .subscribe((status: "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR") => {
        if (status === "SUBSCRIBED") {
          waitingRealtimeHealthyRef.current = true;
          void syncMatchState();
        } else {
          waitingRealtimeHealthyRef.current = false;
        }
      });

    void syncMatchState();
    const interval = window.setInterval(() => {
      if (!waitingRealtimeHealthyRef.current) void syncMatchState();
    }, WAITING_FALLBACK_POLL_MS);
    const resume = () => {
      if (document.visibilityState === "visible") void syncMatchState();
    };
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      mounted = false;
      waitingRealtimeHealthyRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      void supabase.removeChannel(realtime);
    };
  }, [gate, router, userId, waiting]);

  // 等待計時：從 queue.joined_at 起算，和等候頁同一寫法。
  useEffect(() => {
    if (!waiting || !queue || queue.status !== "waiting" || queue.matched_session_id) {
      setElapsedSeconds(0);
      return;
    }
    const parsedJoinedAt = queue.joined_at ? Date.parse(queue.joined_at) : Number.NaN;
    const startAt = Number.isFinite(parsedJoinedAt) ? parsedJoinedAt : Date.now();
    const syncElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startAt) / 1000)));
    syncElapsed();
    const interval = window.setInterval(syncElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [waiting, queue]);

  // 3D 場景：Three.js 只在小鎮頁動態載入，首頁 bundle 不受影響。
  useEffect(() => {
    if (gate !== "allowed") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let renderer: import("three").WebGLRenderer | null = null;
    let raf = 0;

    const makeLabel = (THREE: typeof import("three"), text: string) => {
      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = 512;
      labelCanvas.height = 128;
      const ctx = labelCanvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.roundRect(6, 24, 500, 80, 24);
        ctx.fill();
        ctx.fillStyle = "#2b4a63";
        ctx.font = "bold 44px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 256, 66);
      }
      const texture = new THREE.CanvasTexture(labelCanvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
      sprite.scale.set(5, 1.25, 1);
      return sprite;
    };

    const build = async () => {
      const THREE = await import("three");
      if (cancelled || !canvas) return;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xbfd9ee);
      scene.fog = new THREE.Fog(0xbfd9ee, 30, 70);

      const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 120);
      const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x8fae7e, 1.1);
      scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(12, 20, 8);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      scene.add(sun);

      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(26, 48),
        new THREE.MeshStandardMaterial({ color: 0x9fc98f }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      const plaza = new THREE.Mesh(
        new THREE.CircleGeometry(9, 48),
        new THREE.MeshStandardMaterial({ color: 0xdfe8f2 }),
      );
      plaza.rotation.x = -Math.PI / 2;
      plaza.position.y = 0.02;
      plaza.receiveShadow = true;
      scene.add(plaza);

      // 中央噴泉。
      const basin = new THREE.Mesh(
        new THREE.CylinderGeometry(3, 3.2, 0.6, 32),
        new THREE.MeshStandardMaterial({ color: 0x7fa8c9 }),
      );
      basin.position.y = 0.3;
      basin.castShadow = true;
      scene.add(basin);
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(2.7, 32),
        new THREE.MeshStandardMaterial({ color: 0x6ec1e8 }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.62;
      scene.add(water);
      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.45, 1.6, 16),
        new THREE.MeshStandardMaterial({ color: 0xe8eef4 }),
      );
      column.position.y = 1.2;
      column.castShadow = true;
      scene.add(column);

      // 隨機配對亭：四根柱子＋錐形屋頂，地上有一圈發光環。
      const pavilion = new THREE.Group();
      pavilion.position.set(PAVILION.x, 0, PAVILION.z);
      const postMaterial = new THREE.MeshStandardMaterial({ color: 0x5b8db8 });
      for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3, 0.35), postMaterial);
        post.position.set(px, 1.5, pz);
        post.castShadow = true;
        pavilion.add(post);
      }
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(3.4, 1.8, 4),
        new THREE.MeshStandardMaterial({ color: 0xe88ca0 }),
      );
      roof.position.y = 3.9;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      pavilion.add(roof);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(PAVILION.radius, 0.09, 12, 64),
        new THREE.MeshBasicMaterial({ color: 0xffd166 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      pavilion.add(ring);
      const pavilionLabel = makeLabel(THREE, "隨機配對亭");
      pavilionLabel.position.set(0, 5.4, 0);
      pavilion.add(pavilionLabel);
      scene.add(pavilion);

      // 其他景點這版只做展示：小屋＋招牌，不接真資料。
      const spots: Array<{ x: number; z: number; label: string; color: number }> = [
        { x: -14, z: 0, label: "聊天迴廊（展示）", color: 0x8fb8d8 },
        { x: 14, z: 0, label: "聯絡人花園（展示）", color: 0x8fc9a8 },
        { x: 0, z: 14, label: "站長信箱小屋（展示）", color: 0xd8b48f },
        { x: -10, z: 10, label: "彩蛋角落（展示）", color: 0xc9a8d8 },
      ];
      for (const spot of spots) {
        const hut = new THREE.Mesh(
          new THREE.BoxGeometry(3, 2.2, 3),
          new THREE.MeshStandardMaterial({ color: spot.color }),
        );
        hut.position.set(spot.x, 1.1, spot.z);
        hut.castShadow = true;
        scene.add(hut);
        const label = makeLabel(THREE, spot.label);
        label.position.set(spot.x, 3.4, spot.z);
        scene.add(label);
      }

      const resize = () => {
        if (!renderer) return;
        const width = canvas.clientWidth || window.innerWidth;
        const height = canvas.clientHeight || window.innerHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      window.addEventListener("resize", resize);

      // 拖曳轉視角。
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      const onPointerDown = (event: PointerEvent) => {
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        canvas.setPointerCapture(event.pointerId);
      };
      const onPointerMove = (event: PointerEvent) => {
        if (!dragging) return;
        yawRef.current -= (event.clientX - lastX) * 0.005;
        pitchRef.current = Math.max(
          -0.5,
          Math.min(0.4, pitchRef.current + (event.clientY - lastY) * 0.003),
        );
        lastX = event.clientX;
        lastY = event.clientY;
      };
      const onPointerUp = () => {
        dragging = false;
      };
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);

      const onKeyDown = (event: KeyboardEvent) => {
        keysRef.current.add(event.key.toLowerCase());
      };
      const onKeyUp = (event: KeyboardEvent) => {
        keysRef.current.delete(event.key.toLowerCase());
      };
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);

      let orbitAngle = 0;
      const clock = new THREE.Clock();
      const tick = () => {
        if (cancelled || !renderer) return;
        raf = requestAnimationFrame(tick);
        const delta = Math.min(clock.getDelta(), 0.05);
        if (scenicRef.current) {
          orbitAngle += delta * 0.25;
          camera.position.set(Math.sin(orbitAngle) * 16, 7, Math.cos(orbitAngle) * 16);
          camera.lookAt(0, 1, 0);
        } else {
          const keys = keysRef.current;
          const forward = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
          const strafe = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
          if (forward !== 0 || strafe !== 0) {
            const speed = 5 * delta;
            const sin = Math.sin(yawRef.current);
            const cos = Math.cos(yawRef.current);
            posRef.current.x += (-sin * forward + cos * strafe) * speed;
            posRef.current.z += (-cos * forward - sin * strafe) * speed;
            const dist = Math.hypot(posRef.current.x, posRef.current.z);
            if (dist > TOWN_BOUND) {
              posRef.current.x *= TOWN_BOUND / dist;
              posRef.current.z *= TOWN_BOUND / dist;
            }
            const fountainDist = Math.hypot(posRef.current.x, posRef.current.z);
            if (fountainDist < FOUNTAIN_RADIUS && fountainDist > 0) {
              posRef.current.x *= FOUNTAIN_RADIUS / fountainDist;
              posRef.current.z *= FOUNTAIN_RADIUS / fountainDist;
            }
          }
          camera.position.set(posRef.current.x, 1.7, posRef.current.z);
          camera.rotation.order = "YXZ";
          camera.rotation.y = yawRef.current;
          camera.rotation.x = pitchRef.current;
          const pavilionDist = Math.hypot(posRef.current.x - PAVILION.x, posRef.current.z - PAVILION.z);
          const near = pavilionDist <= PAVILION.radius;
          if (near !== nearPavilionRef.current) {
            nearPavilionRef.current = near;
            setNearPavilion(near);
          }
        }
        renderer.render(scene, camera);
      };
      tick();

      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        renderer?.dispose();
      };
    };

    let cleanup: (() => void) | undefined;
    void build().then((fn) => {
      cleanup = fn;
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanup?.();
      renderer?.dispose();
    };
  }, [gate]);

  const startMatchingFromPavilion = async () => {
    // 防重複：進行中、已在等待、按鈕忙碌時再按都不會重複加入。
    if (matchInFlightRef.current || waiting || actionBusy) return;
    if (MAINTENANCE_MODE) {
      setMessage("HerLink 維護中，聊天功能目前暫時停止。");
      return;
    }
    // 女性限定確認沿用首頁同一把 localStorage 鑰匙；沒確認過就回首頁確認，不繞過。
    if (typeof window !== "undefined" && window.localStorage.getItem("herlink_female_only_ack_v1") !== "1") {
      setMessage("請先回首頁確認女性限定資格，再進配對亭開始配對。");
      return;
    }
    matchInFlightRef.current = true;
    setActionBusy(true);
    setMessage(null);
    try {
      const current = await getCurrentSession();
      if (current.error || !current.data.session) {
        router.replace("/");
        return;
      }
      // 沿用首頁開始配對前的同一道濫用預檢，擋下就不進配對。
      const abuseCheck = await registerAnonymousAbuseIdentity();
      if (abuseCheck.error) throw abuseCheck.error;
      if (abuseCheck.data && abuseCheck.data.decision !== "allow") {
        setMessage("目前無法開始配對，請稍後再試。");
        return;
      }
      // 沿用首頁同一呼叫：findOrJoinRandomMatch(true)，不開新 RPC、不改配對邏輯。
      const matchResult = await findOrJoinRandomMatch(true);
      if (matchResult.error) throw matchResult.error;
      const result = Array.isArray(matchResult.data) ? matchResult.data[0] : matchResult.data;
      if (result?.status === "limit_reached") {
        setMessage("目前已保留 3 個聊天室，請先結束其中一個再配對新的人。");
        return;
      }
      if (result?.status === "matched" && result.session_id) {
        navigatingRef.current = true;
        router.replace(`/waiting?matched=${encodeURIComponent(result.session_id)}`);
        return;
      }
      const queueResult = await loadMyRandomQueue();
      setQueue(queueResult.data ?? null);
      setWaiting(true);
    } catch {
      setMessage("目前無法開始配對，請稍後再試。");
    } finally {
      matchInFlightRef.current = false;
      setActionBusy(false);
    }
  };

  const cancelWaiting = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await leaveRandomQueue();
      setWaiting(false);
      setQueue(null);
      setElapsedSeconds(0);
      setMessage("已離開等待池。");
    } finally {
      setActionBusy(false);
    }
  };

  const pressKey = (key: string) => {
    keysRef.current.add(key);
  };
  const releaseKey = (key: string) => {
    keysRef.current.delete(key);
  };

  if (MAINTENANCE_MODE) {
    return (
      <main className="stack">
        <PageHero title={MAINTENANCE_TITLE} description={MAINTENANCE_MESSAGE}>
          <Notice>目前不開放新的等待配對。</Notice>
          <Button variant="ghost" onClick={() => router.replace("/")}>返回首頁</Button>
        </PageHero>
      </main>
    );
  }

  if (gate !== "allowed") {
    return (
      <main className="stack">
        <PageHero title="正在確認身分…" description="3D 小鎮目前只對孤星企鵝開放，正在確認你的匿名名稱。" />
      </main>
    );
  }

  return (
    <main style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#bfd9ee" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} aria-label="HerLink 3D 小鎮" />
      <div style={{ position: "absolute", top: 12, left: 12, right: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ background: "rgba(255,255,255,0.9)", borderRadius: 12, padding: "8px 12px", fontSize: 14 }}>
          <strong>HerLink 3D 小鎮</strong>
          <div style={{ fontSize: 12, color: "#4a6578" }}>孤星企鵝限定 · 走進配對亭開始真的配對</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              scenicRef.current = !scenicRef.current;
              setScenic(scenicRef.current);
            }}
            style={{ background: "rgba(255,255,255,0.9)", border: "1px solid #b8cfe0", borderRadius: 999, padding: "8px 12px" }}
          >
            {scenic ? "回來走路" : "看風景"}
          </button>
          <button
            type="button"
            onClick={() => void router.push("/")}
            style={{ background: "rgba(255,255,255,0.9)", border: "1px solid #b8cfe0", borderRadius: 999, padding: "8px 12px" }}
          >
            返回首頁
          </button>
        </div>
      </div>

      {nearPavilion && !scenic ? (
        <div style={{ position: "absolute", left: "50%", bottom: 132, transform: "translateX(-50%)", width: "min(92vw, 420px)", background: "rgba(255,255,255,0.95)", borderRadius: 16, padding: 16, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
          <strong>隨機配對亭</strong>
          <p style={{ margin: "6px 0 12px", fontSize: 14, color: "#33506a" }}>
            {waiting
              ? `正在尋找聊天對象…已等待 ${formatElapsed(elapsedSeconds)}，目前有 ${waitingCount === null ? "…" : waitingCount} 人在等。配對到會自動跳去聊天室。`
              : "這裡是真的配對亭，按下就跟首頁「開始匿名配對」一樣進排隊。"}
          </p>
          {waiting ? (
            <button type="button" onClick={() => void cancelWaiting()} disabled={actionBusy} style={{ width: "100%", padding: "10px 12px", borderRadius: 999, border: "1px solid #b8cfe0", background: "#fff" }}>
              {actionBusy ? "處理中…" : "取消配對"}
            </button>
          ) : (
            <button type="button" onClick={() => void startMatchingFromPavilion()} disabled={actionBusy} style={{ width: "100%", padding: "10px 12px", borderRadius: 999, border: "none", background: "#5b8db8", color: "#fff", fontWeight: 700 }}>
              {actionBusy ? "處理中…" : "開始配對"}
            </button>
          )}
        </div>
      ) : null}

      {message ? (
        <div style={{ position: "absolute", left: "50%", bottom: 76, transform: "translateX(-50%)", width: "min(92vw, 420px)", background: "rgba(255,248,220,0.97)", borderRadius: 12, padding: "8px 12px", fontSize: 13, textAlign: "center" }}>
          {message}
        </div>
      ) : null}

      <div style={{ position: "absolute", left: 12, bottom: 12, display: "grid", gridTemplateColumns: "repeat(3, 44px)", gridTemplateRows: "repeat(2, 44px)", gap: 6 }}>
        <span />
        <button type="button" aria-label="向前" onPointerDown={() => pressKey("w")} onPointerUp={() => releaseKey("w")} onPointerLeave={() => releaseKey("w")} style={{ borderRadius: 12, border: "1px solid #b8cfe0", background: "rgba(255,255,255,0.9)", fontSize: 18 }}>▲</button>
        <span />
        <button type="button" aria-label="向左" onPointerDown={() => pressKey("a")} onPointerUp={() => releaseKey("a")} onPointerLeave={() => releaseKey("a")} style={{ borderRadius: 12, border: "1px solid #b8cfe0", background: "rgba(255,255,255,0.9)", fontSize: 18 }}>◀</button>
        <button type="button" aria-label="向後" onPointerDown={() => pressKey("s")} onPointerUp={() => releaseKey("s")} onPointerLeave={() => releaseKey("s")} style={{ borderRadius: 12, border: "1px solid #b8cfe0", background: "rgba(255,255,255,0.9)", fontSize: 18 }}>▼</button>
        <button type="button" aria-label="向右" onPointerDown={() => pressKey("d")} onPointerUp={() => releaseKey("d")} onPointerLeave={() => releaseKey("d")} style={{ borderRadius: 12, border: "1px solid #b8cfe0", background: "rgba(255,255,255,0.9)", fontSize: 18 }}>▶</button>
      </div>
      <div style={{ position: "absolute", right: 12, bottom: 12, maxWidth: 220, background: "rgba(255,255,255,0.85)", borderRadius: 12, padding: "8px 10px", fontSize: 12, color: "#33506a" }}>
        拖曳轉視角 · WASD／方向鍵走路
        <br />配對亭是真的，其他景點這版只做展示。
      </div>
    </main>
  );
}
