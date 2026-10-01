# Mean Pheakdey — HarfBuzz Coming Soon

A motion-graphics coming-soon landing page built around real HarfBuzz glyph shaping and outline interpolation.

## Core morph engine

- HarfBuzz shapes Khmer text into glyphs.
- Glyph outlines are flattened into contours.
- Each contour is resampled to 256 points.
- Old/new contours are paired by centroid, size and winding.
- Every outline point moves with spring physics.

## Coming Soon motion system

The HarfBuzz morph remains the hero. The rest of the page now behaves like one coordinated motion piece:

- oversized Khmer arrival from below the viewport
- true outline reshaping during each typing state
- cinematic camera pull-back as the word assembles
- elastic micro-impact on each HarfBuzz plan
- outline echo trails during morph changes
- kinetic outlined “COMING / SOON” background typography
- slow orbit rings and geometric motion accents
- synchronized “COMING SOON” character reveal
- subtle pointer-driven depth and focal movement
- clean warm-white / near-black palette with one orange status accent
- coordinated hold → exit → rebuild loop
- no grid, no underline, no cursor
- reduced-motion fallback

## Development

```bash
npm install
npm run dev
```

## Production

```bash
npm run build
```

Upload the contents of `dist/` to any static host.

For InfinityFree, upload the built files inside `htdocs/`.
