"use client";

import { useEffect, useRef } from "react";

// 孤星夜空：聊天室背景特效，只給孤星企鵝。
// 深藍夜空上滿天閃爍的淺藍色小星星，配一顆特別亮、帶光暈、會呼吸的「孤星」,
// 偶爾劃過一顆流星。canvas 只負責畫背景，不擋訊息、不吃點擊。

type Star = {
  x: number; // 0..1
  y: number; // 0..1
  r: number; // px at dpr=1
  phase: number;
  speed: number;
  color: string;
};

const STAR_COLORS = ["#bcd9ff", "#dceeff", "#ffffff", "#9fc2ff", "#cfe4ff"];

function makeStars(count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 1.6,
      color: STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0],
    });
  }
  return stars;
}

export function LonelyStarBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let disposed = false;
    let stars = makeStars(90);
    // 孤星固定在右上區域，呼應孤星企鵝。
    const lonely = { x: 0.82, y: 0.16 };
    // 流星狀態：下一次出現時間與目前 streak
    let nextMeteorAt = performance.now() + 6000 + Math.random() * 6000;
    let meteor: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number } | null = null;

    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    if (resizeObserver && canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      if (disposed) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const t = now / 1000;

      // 小星星：呼吸式閃爍
      for (const s of stars) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
        ctx.globalAlpha = tw * 0.8;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // 孤星：本體 + 光暈 + 慢呼吸
      const lx = lonely.x * w;
      const ly = lonely.y * h;
      const breathe = 0.75 + 0.25 * Math.sin(t * 0.9);
      const haloR = 26 * dpr * breathe;
      const halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, haloR);
      halo.addColorStop(0, "rgba(220, 238, 255, 0.55)");
      halo.addColorStop(0.4, "rgba(159, 194, 255, 0.18)");
      halo.addColorStop(1, "rgba(159, 194, 255, 0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(lx, ly, haloR, 0, Math.PI * 2);
      ctx.fill();
      // 星芒
      ctx.strokeStyle = "rgba(220, 238, 255, 0.85)";
      ctx.lineWidth = 1.1 * dpr;
      const spike = 9 * dpr * breathe;
      ctx.beginPath();
      ctx.moveTo(lx - spike, ly); ctx.lineTo(lx + spike, ly);
      ctx.moveTo(lx, ly - spike); ctx.lineTo(lx, ly + spike);
      ctx.stroke();
      // 星核
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(lx, ly, 2.6 * dpr * breathe, 0, Math.PI * 2);
      ctx.fill();

      // 流星：偶爾劃過一道
      if (!meteor && now >= nextMeteorAt && !reducedMotion) {
        const fromLeft = Math.random() < 0.5;
        meteor = {
          x: fromLeft ? -0.05 : 0.35 + Math.random() * 0.7,
          y: Math.random() * 0.35,
          vx: (fromLeft ? 1 : -1) * (0.55 + Math.random() * 0.25),
          vy: 0.22 + Math.random() * 0.12,
          life: 0,
          maxLife: 0.9 + Math.random() * 0.4,
        };
      }
      if (meteor) {
        meteor.life += 1 / 60;
        const p = meteor.life / meteor.maxLife;
        if (p >= 1 || meteor.x < -0.2 || meteor.x > 1.2) {
          meteor = null;
          nextMeteorAt = now + 9000 + Math.random() * 7000;
        } else {
          const mx = meteor.x * w;
          const my = meteor.y * h;
          const fade = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
          const tailLen = 90 * dpr;
          const dx = meteor.vx > 0 ? -1 : 1;
          const grad = ctx.createLinearGradient(mx, my, mx + dx * tailLen, my - tailLen * 0.35);
          grad.addColorStop(0, `rgba(255, 255, 255, ${0.9 * fade})`);
          grad.addColorStop(1, "rgba(159, 194, 255, 0)");
          ctx.globalAlpha = 1;
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.6 * dpr;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(mx + dx * tailLen, my - tailLen * 0.35);
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(mx, my, 1.8 * dpr, 0, Math.PI * 2);
          ctx.fill();
          meteor.x += meteor.vx / 60;
          meteor.y += meteor.vy / 60;
        }
      }

      ctx.globalAlpha = 1;
      if (!reducedMotion && !document.hidden) {
        raf = requestAnimationFrame(draw);
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else if (!reducedMotion && !disposed) {
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (reducedMotion) {
      draw(performance.now()); // 只畫一格靜態星空
    } else {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      resizeObserver?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="lonely-star-bg"
      aria-hidden="true"
    />
  );
}
