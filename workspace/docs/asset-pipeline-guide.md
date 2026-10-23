# Stage 3.1 — Asset Pipeline & Sprite Atlas

## Product goal

Build a file-native media pipeline to complement Stage 3.0's canvas:
import original/appropriately licensed images and audio; verify binary format;
deduplicate by SHA-256; record provenance and license **labels**; select
sprites to build deterministic atlas PNGs; link entries into the same
design.board.json with stable paths; preview without exposing the workspace.

This is not an AI image generator or a license verification service.

## Data model

- assets/<full-sha256>.png|jpg|webp|wav|ogg|mp3 — immutable blobs under the existing
  project workspace. Asset names are SHA-derived; no model-supplied file path.
- assets.catalog.json — versioned catalog with id, path, original filename,
  MIME/kind, byte size, image dimensions, license label, HTTPS source URL,
  createdAt, and optional atlasFrames.
- design.board.json — asset nodes reference the catalog path. Existing
  board schema v1 remains unchanged, including legacy assets/ references.
- Atlas frames record original image digest plus integer x/y/width/height.

A catalog with 128 assets / 30 MiB total, 2 MiB per file, 2048×2048 image
and 4.2M-pixel bounds is intentionally small for the single-user platform.
The atlas tool uses 1-pixel gutters, deterministic digest ordering, at most
16 PNG source images, a 1024px-wide/2048px-high output limit.

## API

GET /api/assets/:sessionId
  Returns catalog entries for authorized session. Does not mutate filesystem.

POST /api/assets/:sessionId (multipart)
  Fields: file, license (unknown/owned/CC0/CC-BY-4.0), source (optional HTTPS).
  Returns HTTP 201 on new asset, HTTP 200 on identical content.
  Supports image/png,image/jpeg,image/webp,audio/wav,audio/ogg,audio/mpeg.

POST /api/assets/:sessionId (application/json)
  {"action":"atlas","ids":["<source-asset-sha256>",...]}
  Generates or reuses a deterministic PNG atlas with frame metadata.

GET /api/assets/:sessionId/:sha256
  Reads only catalogued blobs, verifies SHA-256 on each request, serves exact
  sniffed MIME with nosniff, private no-store and restrictive CSP.

POST calls require the same session capability and same-origin Origin/Host
match as Stage 3.0 writes. No user-supplied paths or external URLs are
fetched server-side, so a provenance URL cannot cause SSRF.

## Image support and compatibility

- PNG is accepted for import; atlas composition supports 8-bit,
  non-interlaced RGB and RGBA only. CRC and length checks are performed.
  Other PNG encodings may be imported but cannot become atlas input
  until converted externally. Filter types 0–4 are decoded.
- JPEG/WebP preserve the original bytes, no server-side lossy transcoding.
- WAV/Ogg/MP3 similarly preserve encoded bytes; browser playback depends
  on browser codec support.
- Animated media, SVG, HTML, ZIP, archives, scripts and remote URLs
  are not accepted as imported assets in this stage.

## UI

New Design Studio > Asset Library tab includes upload file picker,
license/provenance fields, thumbnail/audio preview, SHA-deduplicated
gallery, PNG sprite checkboxes and Generate PNG Atlas button.
"Add to canvas" creates an asset node with the existing v1 stable board ID
and catalog path; save remains explicit and preserves Stage 3.0 undo/redo
and stale-revision conflict behavior.

## Integrity & security notes

The catalog is atomically replaced under a file-based exclusive lock; blobs
are written with exclusive creation and only referenced once catalog commit
succeeds. Catalog and blob symlinks are rejected; a corrupted blob fails
SHA validation instead of being served. Existing projects and their untracked
asset files are preserved, and imports never alter scripts/game.js.

The catalog's license field is user-submitted metadata, not legal proof.
Copyright, security scanning, image decoder vulnerabilities, audio metadata,
concurrent writers across different hosts, malware analysis and image quality
are **not** solved by MIME allowlisting. Do not deploy this file-processing
pipeline to untrusted public multi-tenant workloads until OS sandbox workers,
independent content validation and durable storage are implemented.

## Stage 3.2 / 4.x follow-up

- Rich asset processing with vetted imaging codecs, audio level/format
  normalization, waveform previews, animation/spritesheet slicing.
- Explicit usage/provenance references and reversible deletions.
- Server-side audit and historical versions, immutable object storage.
- Job queue and sandboxed asynchronous media conversion.
- Golden-set visual regression for games and multi-user access policies.

## Verification contract

Test deterministic atlas frames/output; import PNG/audio; duplicate id;
quota bounds; SVG rejection; tampering/symlinks; API permission and CSRF;
browser upload + gallery + canvas reference + atlas; preexisting Stage 2.1
through 3.0 browser regression; tsc + ESLint + production build.
