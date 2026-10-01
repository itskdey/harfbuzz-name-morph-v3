# Mean Pheakdey — HarfBuzz Outline Morph v3

A minimal name landing page using the same core technique as `seanghay/typing-morph`:

- HarfBuzz shapes Khmer text into glyphs.
- Glyph outlines are flattened into contours.
- Each contour is resampled to 256 points.
- Old/new contours are paired by centroid, size and winding.
- Every outline point is moved with spring physics.

## v3 changes

- Removed the grid completely.
- Removed the underline completely.
- No typing cursor.
- Clean white / near-black reference-site palette.
- Cinematic camera choreography inspired by the supplied screen recording:
  - large glyph crop rises from below the viewport,
  - the Khmer name assembles while the camera pulls back,
  - elastic micro-impact on each HarfBuzz shaping step,
  - subtle outline echo trails during morph transitions,
  - staged Latin subtitle reveal,
  - final variable-weight breathing morph,
  - looped exit/re-entry sequence.
- Subtle pointer parallax remains, but is intentionally restrained.

## Run

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

Upload the contents of `dist/` to your static host (for InfinityFree, upload them into `htdocs/`).
