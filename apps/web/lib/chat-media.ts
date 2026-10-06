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

  // Some Android gallery/file pickers return an empty MIME type even for a valid
  // JPEG/PNG/WebP file. In that case the extension is the best browser-provided
  // signal we have and the decoded image is validated again before upload.
  if (file.type && !allowedTypes.includes(file.type)) {
    return { code: "invalid_type", message: "只支援 JPEG / PNG / WebP 圖片。" };
  }

  // Camera photos are often larger than the final 5 MB upload limit. Allow a
  // reasonable source size and resize/re-encode it before it reaches Storage.
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

    const extension = getChatImageExtension(file);
    const outputType =
      file.type === "image/webp" || (!file.type && extension === "webp")
        ? "image/webp"
        : file.type === "image/png" || (!file.type && extension === "png")
          ? "image/png"
          : "image/jpeg";
    if (outputType === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);

    let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, 0.9));
    if (!blob) {
      throw new Error("image encode failed");
    }

    let finalType = outputType;
    // PNG screenshots can remain unexpectedly large after resizing. If the
    // encoded result is still above the Storage limit, fall back to JPEG.
    if (blob.size > MAX_CHAT_IMAGE_BYTES) {
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      const jpegBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!jpegBlob) {
        throw new Error("image encode failed");
      }
      blob = jpegBlob;
      finalType = "image/jpeg";
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