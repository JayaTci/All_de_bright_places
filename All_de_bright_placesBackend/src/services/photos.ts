// Validates and normalizes journal photographs without retaining embedded metadata.
import "server-only";
import sharp from "sharp";
import { HttpError } from "../utils/http";

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/** Decodes a bounded image and generates two metadata-free WebP variants. */
export async function normalizePhoto(input: Uint8Array) {
  if (!input.length || input.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "Choose a photograph smaller than 3 MB.");
  try {
    const image = sharp(input, { limitInputPixels: 40_000_000, animated: false, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || "") || (metadata.pages || 1) > 1) throw new HttpError(400, "Choose a JPEG, PNG, or WebP photograph.");
    const [display, thumbnail] = await Promise.all([
      image.clone().rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true }),
      image.clone().rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 76 }).toBuffer(),
    ]);
    if (display.data.length > MAX_UPLOAD_BYTES || thumbnail.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "This photograph is too large after processing.");
    return { display: display.data, thumbnail, width: display.info.width, height: display.info.height };
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "This photograph could not be read."); }
}

/** Returns controlled storage paths generated exclusively from a validated UUID. */
export function photoPaths(id: string) { return [`display/${id}.webp`, `thumbnail/${id}.webp`]; }
