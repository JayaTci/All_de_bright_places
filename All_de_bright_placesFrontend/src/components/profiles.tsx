// Presents editor profiles and gives each MFA-verified editor control of their own picture and bio.
"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import type { EditorProfile, EditorUsername } from "@bright/shared";
import { request } from "../services/api";
import styles from "./profiles.module.css";

const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const PREVIEW_SIZE = 256;
const OUTPUT_SIZE = 512;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Returns the fixed display name for an editor account.
function displayName(username: EditorUsername) { return username === "ruby" ? "Ruby" : "Jayatci"; }

// Keeps a percentage within the available crop range.
function clamp(value: number) { return Math.min(100, Math.max(0, value)); }

/** Draws the same square crop into a preview or export canvas.
 * @param canvas - The target canvas.
 * @param image - The decoded source picture.
 * @param zoom - The crop zoom factor.
 * @param horizontal - Horizontal crop position from 0 to 100.
 * @param vertical - Vertical crop position from 0 to 100.
 * @returns Nothing; the output is painted on the canvas.
 */
function drawCrop(canvas: HTMLCanvasElement, image: ImageBitmap, zoom: number, horizontal: number, vertical: number) {
  const context = canvas.getContext("2d"); if (!context) return;
  const crop = Math.min(image.width, image.height) / zoom;
  const x = (image.width - crop) * horizontal / 100;
  const y = (image.height - crop) * vertical / 100;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, x, y, crop, crop, 0, 0, canvas.width, canvas.height);
}

/** Shows an authorized picture or the account's original initial.
 * @param profile - The viewer-filtered editor profile.
 * @param large - Whether to use the homepage card size.
 * @returns An image or a readable initial in the notebook's avatar shape.
 */
export function ProfileAvatar({ profile, large = false }: { profile: EditorProfile; large?: boolean }) {
  const name = displayName(profile.username);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasVisiblePicture = Boolean(profile.pictureUrl && failedUrl !== profile.pictureUrl);
  return <span className={`${styles.avatar} ${styles[profile.username]} ${large ? styles.large : ""}`} role="img" aria-label={hasVisiblePicture ? `Portrait of ${name}` : `${name}'s initial`}>
    {hasVisiblePicture ? <img src={profile.pictureUrl!} alt="" width={large ? 64 : 28} height={large ? 64 : 28} onError={() => setFailedUrl(profile.pictureUrl)} /> : <span aria-hidden="true">{name[0]}</span>}
  </span>;
}

/** Introduces both editors using only the profile data visible to this visitor.
 * @param profiles - The viewer-filtered public profiles.
 * @returns Two compact notebook profile cards.
 */
export function ProfileCards({ profiles }: { profiles: EditorProfile[] }) {
  return <section className={styles.cardsSection} aria-labelledby="our-profiles-title">
    <div className={styles.cardsHeading}><span className="eyebrow">THE PEOPLE BEHIND THESE PAGES</span><h2 id="our-profiles-title">A little about us</h2></div>
    <div className={styles.cards}>{profiles.map(profile => <article className={styles.card} key={profile.username}>
      <ProfileAvatar profile={profile} large />
      <div><h3>{displayName(profile.username)}</h3><p>{profile.bio || "A few words will find their place here."}</p></div>
    </article>)}</div>
  </section>;
}

/** Previews a square image crop and exports its pixels without source metadata.
 * @param file - The selected original image.
 * @param onSave - Uploads the finished WebP blob after review.
 * @param onCancel - Returns to the profile form without changing the saved picture.
 * @returns Crop controls and a canvas preview.
 */
function PictureCrop({ file, onSave, onCancel }: { file: File; onSave: (blob: Blob) => Promise<void>; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<ImageBitmap | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [horizontal, setHorizontal] = useState(50);
  const [vertical, setVertical] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void createImageBitmap(file).then(image => {
      if (active) { imageRef.current = image; setReady(true); }
      else image.close();
    }).catch(() => { if (active) setError("This image could not be opened. Choose another JPEG, PNG, or WebP file."); });
    return () => { active = false; imageRef.current?.close(); imageRef.current = null; };
  }, [file]);

  useEffect(() => { if (ready && canvasRef.current && imageRef.current) drawCrop(canvasRef.current, imageRef.current, zoom, horizontal, vertical); }, [ready, zoom, horizontal, vertical]);

  /** Moves the crop in the opposite direction of a picture drag.
   * @param event - The pointer's latest position over the preview.
   * @returns Nothing; state is updated if a drag is active.
   */
  function movePointer(event: PointerEvent<HTMLCanvasElement>) {
    const previous = dragRef.current; const image = imageRef.current;
    if (!previous || !image) return;
    const side = Math.min(image.width, image.height) / zoom;
    const width = canvasRef.current?.getBoundingClientRect().width || PREVIEW_SIZE;
    const xRange = image.width - side; const yRange = image.height - side;
    if (xRange > 0) setHorizontal(value => clamp(value - (event.clientX - previous.x) * side / width / xRange * 100));
    if (yRange > 0) setVertical(value => clamp(value - (event.clientY - previous.y) * side / width / yRange * 100));
    dragRef.current = { x: event.clientX, y: event.clientY };
  }

  /** Exports the reviewed square WebP and keeps the crop open after a failed upload.
   * @returns A promise that resolves after the upload callback completes.
   */
  async function save() {
    if (!ready) return;
    setBusy(true); setError("");
    try {
      const canvas = document.createElement("canvas"); canvas.width = OUTPUT_SIZE; canvas.height = OUTPUT_SIZE;
      if (!imageRef.current) throw new Error("The picture is no longer available. Choose it again.");
      drawCrop(canvas, imageRef.current, zoom, horizontal, vertical);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.82));
      if (!blob || blob.type !== "image/webp" || blob.size > MAX_UPLOAD_BYTES) throw new Error("This crop could not be prepared. Try another picture.");
      await onSave(blob);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The picture could not be saved."); }
    finally { setBusy(false); }
  }

  return <div className={styles.cropPanel}>
    <p className={styles.cropTitle}>Make the picture yours</p>
    <p className="field-note">Drag the preview to position the picture. You can also use the sliders, or focus the preview and use the arrow keys to move the crop area.</p>
    <canvas ref={canvasRef} width={PREVIEW_SIZE} height={PREVIEW_SIZE} className={styles.cropPreview} role="img" tabIndex={0} aria-label="Square picture crop preview. Use arrow keys to move the crop area." onPointerDown={event => { if (!ready) return; dragRef.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={movePointer} onPointerUp={event => { dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { dragRef.current = null; }} onKeyDown={event => { const step = event.shiftKey ? 10 : 2; if (event.key === "ArrowLeft") setHorizontal(value => clamp(value - step)); else if (event.key === "ArrowRight") setHorizontal(value => clamp(value + step)); else if (event.key === "ArrowUp") setVertical(value => clamp(value - step)); else if (event.key === "ArrowDown") setVertical(value => clamp(value + step)); else return; event.preventDefault(); }} />
    <div className={styles.cropSliders}><label>Zoom<input type="range" min="1" max="3" step="0.05" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label><label>Crop position, left to right<input type="range" min="0" max="100" value={horizontal} onChange={event => setHorizontal(Number(event.target.value))} /></label><label>Crop position, top to bottom<input type="range" min="0" max="100" value={vertical} onChange={event => setVertical(Number(event.target.value))} /></label></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className={styles.actions}><button type="button" className="button primary" disabled={!ready || busy} onClick={() => void save()}>{busy ? "Saving picture…" : "Use this picture"}</button><button type="button" className="button" disabled={busy} onClick={onCancel}>Choose another</button></div>
  </div>;
}

/** Saves the current editor's public bio, picture privacy, and optional cropped picture.
 * @param profile - The editor's own server-filtered profile.
 * @param refresh - Reloads the authorized journal after a successful change.
 * @returns Profile settings for the account page.
 */
export function ProfileEditor({ profile, refresh }: { profile: EditorProfile; refresh: () => Promise<void> }) {
  const [bio, setBio] = useState(profile.bio);
  const [visibility, setVisibility] = useState<"public" | "friends">(profile.pictureVisibility);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const name = displayName(profile.username);
  const path = `/api/profiles/${profile.username}`;

  /** Persists bio and visibility before any picture upload.
   * @returns A promise for the completed profile save.
   */
  async function saveSettings() {
    await request(path, { bio, pictureVisibility: visibility }, "PATCH");
    await refresh();
  }

  /** Saves the settings form while preserving its draft after an error.
   * @returns A promise for the form submission.
   */
  async function submit() {
    setBusy(true); setError(""); setMessage("");
    try { await saveSettings(); setMessage("Your profile has been saved."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Your profile could not be saved."); }
    finally { setBusy(false); }
  }

  /** Checks an original image before opening the crop review.
   * @param selected - A browser-selected file, if any.
   * @returns Nothing; the selected file is held locally until the editor saves the crop.
   */
  function chooseFile(selected?: File) {
    setError(""); setMessage("");
    if (!selected) return;
    if (!IMAGE_TYPES.includes(selected.type)) { setError("Choose a JPEG, PNG, or WebP picture."); return; }
    if (selected.size > MAX_SOURCE_BYTES) { setError("Choose a picture smaller than 30 MB."); return; }
    setFile(selected);
  }

  /** Persists settings, then uploads the reviewed metadata-free WebP crop.
   * @param blob - The rendered square WebP image.
   * @returns A promise that resolves after upload and journal refresh.
   */
  async function upload(blob: Blob) {
    await saveSettings();
    const body = new FormData(); body.set("file", blob, "profile.webp");
    await request(`${path}/picture`, body);
    setFile(null); setMessage("Your picture has been saved.");
    await refresh();
  }

  /** Removes only this editor's picture and returns the initial fallback.
   * @returns A promise for the delete and journal refresh.
   */
  async function removePicture() {
    setBusy(true); setError(""); setMessage("");
    try { await request(`${path}/picture`, undefined, "DELETE"); await refresh(); setMessage("Your picture has been removed."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The picture could not be removed."); }
    finally { setBusy(false); }
  }

  return <section className={styles.editor} aria-labelledby="profile-settings-title">
    <div className={styles.editorIntro}><div><span className="eyebrow">A PAGE OF YOUR OWN</span><h2 id="profile-settings-title">Your profile</h2><p>Your name and bio can be seen by anyone who visits this notebook. You choose who can see your picture.</p></div><ProfileAvatar profile={profile} large /></div>
    <form className="editor-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>About {name}<textarea rows={3} maxLength={240} value={bio} onChange={event => setBio(event.target.value)} placeholder="A few words about you…" /></label>
      <p className={styles.count}>{bio.length}/240 characters</p>
      <label>Who can see your picture?<select value={visibility} onChange={event => setVisibility(event.target.value as "public" | "friends")}><option value="public">Public, anyone visiting</option><option value="friends">Friends only, Ruby and Jayatci after verification</option></select></label>
      <p className="field-note">Your bio stays public. Friends only pictures appear as an initial to visitors. A picture shared publicly may already have been saved by someone else.</p>
      <button className="button primary" disabled={busy || !!file}>{busy ? "Saving…" : "Save profile"}</button>
    </form>
    <div className={styles.pictureArea}><h3>Your picture</h3><p className="field-note">Choose a JPEG, PNG, or WebP under 30 MB. You can crop it before saving.</p>
      {file ? <PictureCrop key={file.name + file.lastModified} file={file} onSave={upload} onCancel={() => setFile(null)} /> : <div className={styles.pictureActions}><label className={styles.fileLabel}><ImagePlus size={17} />{profile.hasPicture ? "Replace picture" : "Add a picture"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} /></label>{profile.hasPicture && <button className="button" type="button" disabled={busy} onClick={() => void removePicture()}><Trash2 size={15} />Remove picture</button>}</div>}
    </div>
    {message && <p className={styles.feedback} role="status"><Camera size={16} />{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
