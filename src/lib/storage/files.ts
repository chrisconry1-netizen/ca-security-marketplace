export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const MESSAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type AvatarMime = "image/jpeg" | "image/png" | "image/webp";
export type DocumentMime = "application/pdf" | "image/jpeg" | "image/png" | "image/heic";
export type MessageAttachmentMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

const AVATAR_EXT: Record<AvatarMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const DOCUMENT_EXT: Record<DocumentMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
};

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

export function detectAvatar(bytes: Uint8Array): { mime: AvatarMime; ext: string } | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: AVATAR_EXT["image/png"] };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: AVATAR_EXT["image/jpeg"] };
  if (bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { mime: "image/webp", ext: AVATAR_EXT["image/webp"] };
  }
  return null;
}

export function detectDocument(bytes: Uint8Array): { mime: DocumentMime; ext: string } | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return { mime: "application/pdf", ext: DOCUMENT_EXT["application/pdf"] };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: DOCUMENT_EXT["image/png"] };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: DOCUMENT_EXT["image/jpeg"] };
  if (bytes.length > 12) {
    const brand = String.fromCharCode(...bytes.slice(4, 8));
    const major = String.fromCharCode(...bytes.slice(8, 12));
    if (brand === "ftyp" && /^(heic|heix|mif1|msf1|hevc|hevx)$/.test(major)) {
      return { mime: "image/heic", ext: DOCUMENT_EXT["image/heic"] };
    }
  }
  return null;
}

export function sniffAvatar(bytes: Uint8Array): { mime: AvatarMime; ext: string } | null {
  if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_MAX_BYTES) return null;
  return detectAvatar(bytes);
}

export function sniffDocument(bytes: Uint8Array): { mime: DocumentMime; ext: string } | null {
  if (bytes.byteLength === 0 || bytes.byteLength > DOCUMENT_MAX_BYTES) return null;
  return detectDocument(bytes);
}

/** Message files match the private message-attachments bucket. HEIC is not allowed. */
export function sniffMessageAttachment(bytes: Uint8Array): { mime: MessageAttachmentMime; ext: string } | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MESSAGE_ATTACHMENT_MAX_BYTES) return null;
  const avatar = detectAvatar(bytes);
  if (avatar) return avatar;
  const document = detectDocument(bytes);
  if (document?.mime === "application/pdf") return { mime: "application/pdf", ext: "pdf" };
  return null;
}
