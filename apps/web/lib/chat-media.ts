export const ALLOWED_CHAT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ALLOWED_CHAT_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_CHAT_IMAGE_DIMENSION = 1600;

export type ChatImageValidationError = {
  code: "invalid_type" | "invalid_extension" | "too_large";
  message: string;
};

export function validateChatImageFile(file: File): ChatImageValidationError | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const allowedTypes: readonly string[] = ALLOWED_CHAT_IMAGE_TYPES;
  const allowedExtensions: readonly string[] = ALLOWED_CHAT_IMAGE_EXTENSIONS;

  if (!allowedTypes.includes(file.type)) {
    return { code: "invalid_type", message: "只支援 JPEG / PNG / WebP 圖片。" };
  }

  if (!allowedExtensions.includes(extension)) {
    return { code: "invalid_extension", message: "不支援這個檔案類型。" };
  }

  if (file.size > MAX_CHAT_IMAGE_BYTES) {
    return { code: "too_large", message: "圖片超過 5MB 限制，請選擇較小的圖片。" };
  }

  return null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image decode failed"));
    image.src = url;
  });
}

export async function loadChatImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareChatImage(file: File): Promise<{
  blob: Blob;
  width: number;
  height: number;
  extension: "jpg" | "png" | "webp";
}> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, MAX_CHAT_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("canvas unavailable");
    }

    const outputType =
      file.type === "image/webp" ? "image/webp" : file.type === "image/png" ? "image/png" : "image/jpeg";
    if (outputType === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, 0.85));
    if (!blob) {
      throw new Error("image encode failed");
    }

    const extension = outputType === "image/webp" ? "webp" : outputType === "image/png" ? "png" : "jpg";
    return { blob, width, height, extension };
  } finally {
    URL.revokeObjectURL(url);
  }
}
