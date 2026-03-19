"use client";

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        reject(new Error("data-url-empty"));
        return;
      }
      resolve(dataUrl);
    };
    reader.onerror = () => reject(new Error("data-url-read-error"));
    reader.readAsDataURL(file);
  });
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image-load-error"));
    image.src = src;
  });
}

export async function compressImageToDataUrl(file: File, maxSide: number, quality = 0.72): Promise<string> {
  const src = await fileToDataUrl(file);
  const img = await loadImage(src);
  const width = img.width || maxSide;
  const height = img.height || maxSide;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function cropImageToAspectDataUrl(
  file: File,
  targetWidth: number,
  targetHeight: number,
  quality = 0.86
): Promise<string> {
  const src = await fileToDataUrl(file);
  const img = await loadImage(src);
  const sourceWidth = img.width || targetWidth;
  const sourceHeight = img.height || targetHeight;
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;

  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (sourceRatio > targetRatio) {
    cropWidth = Math.round(sourceHeight * targetRatio);
    offsetX = Math.max(0, Math.round((sourceWidth - cropWidth) / 2));
  } else if (sourceRatio < targetRatio) {
    cropHeight = Math.round(sourceWidth / targetRatio);
    offsetY = Math.max(0, Math.round((sourceHeight - cropHeight) / 2));
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;

  ctx.drawImage(img, offsetX, offsetY, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function imageFileToStorableDataUrl(file: File, maxSide: number, quality = 0.72): Promise<string> {
  const mime = String(file.type || "").toLowerCase();
  if (mime.includes("gif")) return fileToDataUrl(file);
  return compressImageToDataUrl(file, maxSide, quality);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = String(dataUrl || "").split(",");
  if (parts.length < 2) {
    throw new Error("data-url-invalid");
  }

  const match = parts[0].match(/data:(.*?);base64/);
  const mime = match?.[1] || "image/jpeg";
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}
