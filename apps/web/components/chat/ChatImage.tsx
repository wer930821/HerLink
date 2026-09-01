"use client";

import { useEffect, useRef, useState } from "react";
import { createChatMediaSignedUrl } from "../../lib/supabase";

type ChatImageProps = {
  path: string;
  alt: string;
  large?: boolean;
  onOpen?: () => void;
};

const SIGNED_URL_EXPIRY_SECONDS = 300;
const RE_SIGN_INTERVAL_MS = 240000;

export function ChatImage({ path, alt, large = false, onOpen }: ChatImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const sign = async () => {
      const { data, error } = await createChatMediaSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
      if (!mounted) {
        return;
      }
      if (!error && data?.signedUrl) {
        setUrl(data.signedUrl);
      } else {
        setFailed(true);
      }
    };

    void sign();
    timerRef.current = window.setInterval(() => {
      void sign();
    }, RE_SIGN_INTERVAL_MS);

    return () => {
      mounted = false;
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [path]);

  if (failed) {
    return <div className="chat-image chat-image-state">圖片無法載入</div>;
  }

  const image = url ? (
    <img
      className={`chat-image${large ? " chat-image-large" : ""}`}
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="chat-image chat-image-state">載入中…</div>
  );

  if (onOpen) {
    return (
      <button type="button" className="chat-image-wrap" onClick={onOpen} aria-label={`${alt}（點擊放大）`}>
        {image}
      </button>
    );
  }

  return image;
}
