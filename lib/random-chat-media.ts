import * as ImageManipulator from "expo-image-manipulator";
import { File } from "expo-file-system";
import { Platform } from "react-native";

export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_CHAT_IMAGE_DIMENSION = 1600;

export type PreparedRandomChatImage = {
  uri: string;
  bytes: Uint8Array;
  size: number;
  mime: "image/jpeg";
  width: number;
  height: number;
};

export class RandomChatImageError extends Error {
  constructor(
    message: string,
    public code: "unsupported" | "too_large" | "decode_failed" | "platform"
  ) {
    super(message);
    this.name = "RandomChatImageError";
  }
}

/**
 * Mirrors the production Web chat-media rules: private `chat-media` bucket,
 * JPEG/PNG/WebP source, <=5MB, dimension cap, then a JPEG encode before upload.
 * The Web path applies the same normalization (`prepareChatImage`), so both
 * clients produce comparable objects without any public bucket.
 */
export async function prepareRandomChatImage(input: {
  uri: string;
  width: number;
  height: number;
  fileName?: string | null;
  mimeType?: string | null;
}): Promise<PreparedRandomChatImage> {
  if (Platform.OS === "web") {
    throw new RandomChatImageError("Web 不支援此上傳流程。", "platform");
  }

  const sourceType = (input.mimeType ?? "").toLowerCase();
  const sourceName = (input.fileName ?? "").toLowerCase();
  const allowedSource =
    sourceType.startsWith("image/jpeg") ||
    sourceType === "image/png" ||
    sourceType === "image/webp" ||
    sourceName.endsWith(".jpg") ||
    sourceName.endsWith(".jpeg") ||
    sourceName.endsWith(".png") ||
    sourceName.endsWith(".webp");

  if (!allowedSource) {
    throw new RandomChatImageError("只支援 JPEG / PNG / WebP 圖片。", "unsupported");
  }

  const sourceWidth = Math.max(1, Math.trunc(input.width) || 1);
  const sourceHeight = Math.max(1, Math.trunc(input.height) || 1);
  const scale = Math.min(
    1,
    MAX_CHAT_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight)
  );
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  try {
    const context = ImageManipulator.ImageManipulator.manipulate(input.uri);
    if (scale < 1) {
      context.resize({ width: targetWidth, height: targetHeight });
    }
    const imageRef = await context.renderAsync();
    const saved = await imageRef.saveAsync({
      format: ImageManipulator.SaveFormat.JPEG,
      compress: 0.85,
    });

    const file = new File(saved.uri);
    const bytes = await file.bytes();
    if (bytes.byteLength > MAX_CHAT_IMAGE_BYTES) {
      throw new RandomChatImageError("圖片超過 5MB 限制，請選擇較小的圖片。", "too_large");
    }

    return {
      uri: saved.uri,
      bytes,
      size: bytes.byteLength,
      mime: "image/jpeg",
      width: Math.max(1, saved.width),
      height: Math.max(1, saved.height),
    };
  } catch (error) {
    if (error instanceof RandomChatImageError) {
      throw error;
    }
    throw new RandomChatImageError("這張圖片無法讀取，請換一張試試。", "decode_failed");
  }
}
