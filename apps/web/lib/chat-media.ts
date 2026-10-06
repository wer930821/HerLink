export const ALLOWED_CHAT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ALLOWED_CHAT_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_CHAT_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_CHAT_IMAGE_DIMENSION = 2048;

export type ChatImageValidationError = {
  code: "invalid_type" | "invalid_extension" | "too_large";
  message: string;
};

function getChatImageExtension(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

export function validateChatImageFile(file: File): ChatImageValidationError | null {
  const extension = getChatImageExtension(file);
  const allowedTypes: readonly string[] = ALLOWED_CHAT_IMAGE_TYPES;
  const allowedExtensions: readonly string[] = ALLOWED_CHAT_IMAGE_EXTENSIONS;

  if (!allowedExtensions.includes(extension)) {
    return { code: "invalid_extension", message: "不支援這個檔案類型。" };
  }

  if (file.type && !allowedTypes.includes(file.type)) {
    return { code: "invalid_type", message: "只支援 JPEG / PNG / WebP 圖片。" };
  }

  if (file.size > MAX_CHAT_IMAGE_SOURCE_BYTES) {
    return { code: "too_large", message: "圖片檔案過大，請選擇 25MB 以下的圖片。" };
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

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("image encode failed"));
    }, type, quality);
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
    const initialScale = Math.min(1, MAX_CHAT_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    let width = Math.max(1, Math.round(image.naturalWidth * initialScale));
    let height = Math.max(1, Math.round(image.naturalHeight * initialScale));

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");

    const extension = getChatImageExtension(file);
    const sourceType =
      file.type === "image/webp" || (!file.type && extension === "webp")
        ? "image/webp"
        : file.type === "image/png" || (!file.type && extension === "png")
          ? "image/png"
          : "image/jpeg";

    const draw = (nextWidth: number, nextHeight: number, whiteBackground: boolean) => {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      context.clearRect(0, 0, nextWidth, nextHeight);
      if (whiteBackground) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, nextWidth, nextHeight);
      }
      context.drawImage(image, 0, 0, nextWidth, nextHeight);
    };

    draw(width, height, sourceType === "image/jpeg");
    let finalType = sourceType;
    let blob = await canvasToBlob(canvas, sourceType, 0.9);

    // Keep the high-quality 2048px result whenever possible. If it is still
    // larger than Storage's 5 MB limit, progressively lower JPEG quality and,
    // only when needed, dimensions until it fits. Users should not have to
    // manually resize ordinary camera photos before sending them.
    if (blob.size > MAX_CHAT_IMAGE_BYTES) {
      finalType = "image/jpeg";
      const qualities = [0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6];
      const dimensionScales = [1, 0.9, 0.8, 0.7, 0.6];

      outer: for (const dimensionScale of dimensionScales) {
        width = Math.max(1, Math.round(image.naturalWidth * initialScale * dimensionScale));
        height = Math.max(1, Math.round(image.naturalHeight * initialScale * dimensionScale));
        draw(width, height, true);

        for (const quality of qualities) {
          blob = await canvasToBlob(canvas, "image/jpeg", quality);
          if (blob.size <= MAX_CHAT_IMAGE_BYTES) break outer;
        }
      }
    }

    if (blob.size > MAX_CHAT_IMAGE_BYTES) {
      throw new Error("media size is not allowed");
    }

    const finalExtension = finalType === "image/webp" ? "webp" : finalType === "image/png" ? "png" : "jpg";
    return { blob, width, height, extension: finalExtension };
  } finally {
    URL.revokeObjectURL(url);
  }
}