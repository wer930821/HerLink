"use client";

import { getAnonymousAvatarOption } from "../../../lib/anonymous";

type Props = {
  avatarId: string;
  size?: number;
  label?: string;
};

export function AnonymousAvatar({ avatarId, size = 72, label }: Props) {
  const option = getAnonymousAvatarOption(avatarId);
  const text = label ?? option.label.slice(0, 2);

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        color: option.fg,
        background: `linear-gradient(180deg, ${option.bg}, rgba(255,255,255,0.08))`,
        border: "1px solid rgba(255,255,255,0.08)",
        fontWeight: 800,
        letterSpacing: "0.04em",
      }}
    >
      <span style={{ fontSize: Math.max(12, size * 0.22) }}>{text}</span>
    </div>
  );
}
