// Verifies real image decoding, normalization, bounds, and metadata removal.
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MAX_UPLOAD_BYTES, normalizePhoto } from "../src/services/photos";

describe("photograph processing", () => {
  it("rotates and resizes the display variant and removes embedded metadata", async () => {
    const input = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#e8d9be" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const output = await normalizePhoto(input);
    expect(output.width).toBe(1024); expect(output.height).toBe(2048);
    const display = await sharp(output.display).metadata(); const thumbnail = await sharp(output.thumbnail).metadata();
    expect(display.format).toBe("webp"); expect(display.exif).toBeUndefined(); expect(display.icc).toBeUndefined();
    expect(thumbnail.width).toBe(320); expect(thumbnail.height).toBe(640);
  });
  it("rejects unsupported formats and corrupt bytes", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>');
    await expect(normalizePhoto(svg)).rejects.toMatchObject({ status: 400 });
    await expect(normalizePhoto(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ status: 400 });
  });
  it("rejects oversized upload buffers before decoding", async () => {
    await expect(normalizePhoto(new Uint8Array(MAX_UPLOAD_BYTES + 1))).rejects.toMatchObject({ status: 413 });
  });
});
