"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createChatMediaSignedUrl } from "../../lib/supabase";
import { getCachedSignedUrl, invalidateCachedSignedUrl } from "../../../../lib/signed-url-cache";

type ChatImageProps = {
  path: string;
  alt: string;
  large?: boolean;
  onOpen?: () => void;
};

const SIGNED_URL_EXPIRY_SECONDS = 300;
const SIGNED_URL_TTL_MS = SIGNED_URL_EXPIRY_SECONDS * 1000;
const SIGNED_URL_REFRESH_THRESHOLD_MS = 60_000;
const MAX_IMAGE_LOAD_RETRIES = 1;

export function ChatImage({ path, alt, large = false, onOpen }: ChatImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retryCountRef = useRef(0);
  const requestGenerationRef = useRef(0);

  const resolveUrl = useCallback(() => {
    return getCachedSignedUrl(
      path,
      async () => {
        const { data, error } = await createChatMediaSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
        if (error || !data?.signedUrl) {
          throw error ?? new Error("Unable to sign chat media URL");
        }
        return data.signedUrl;
      },
      {
        ttlMs: SIGNED_URL_TTL_MS,
        refreshThresholdMs: SIGNED_URL_REFRESH_THRESHOLD_MS,
      }
    );
  }, [path]);

  useEffect(() => {
    const requestGeneration = ++requestGenerationRef.current;
    retryCountRef.current = 0;
    void resolveUrl()
      .then((signedUrl) => {
        if (requestGenerationRef.current === requestGeneration) {
          setUrl((current) => (current === signedUrl ? current : signedUrl));
          setFailed(false);
        }
      })
      .catch(() => {
        if (requestGenerationRef.current === requestGeneration) setFailed(true);
      });

    return () => {
      if (requestGenerationRef.current === requestGeneration) {
        requestGenerationRef.current += 1;
      }
    };
  }, [resolveUrl]);

  const retryOnce = () => {
    if (retryCountRef.current >= MAX_IMAGE_LOAD_RETRIES) {
      setFailed(true);
      return;
    }

    retryCountRef.current += 1;
    invalidateCachedSignedUrl(path);
    const requestGeneration = requestGenerationRef.current;
    void resolveUrl()
      .then((signedUrl) => {
        if (requestGenerationRef.current === requestGeneration) {
          setUrl((current) => (current === signedUrl ? current : signedUrl));
          setFailed(false);
        }
      })
      .catch(() => {
        if (requestGenerationRef.current === requestGeneration) setFailed(true);
      });
  };

  const image = url ? (
    <img
      className={`chat-image${large ? " chat-image-large" : ""}`}
      src={url}
      alt={alt}
      loading="lazy"
      onError={retryOnce}
    />
  ) : failed ? (
    <div className="chat-image chat-image-state">圖片無法載入</div>
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
