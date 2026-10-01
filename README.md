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

## Three.js depth motion

The hero uses a lazy-loaded Three.js scene with a perspective camera. The live
HarfBuzz outlines feed a shared canvas mask across eight shallow depth slices.
A vertex wave and damped recoil follow the existing shaping timeline; pointer
movement smoothly rotates the volume. The warm paper and ink palette stays intact.

Texture uploads happen only while the contours change. Pixel density is capped
at 1.75, geometry is reused, and rendering pauses while the page is hidden.
WebGL failure or context loss reveals the SVG renderer. Reduced motion skips
Three.js and renders the completed name immediately without an animation loop.

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


## Automatic deploy to InfinityFree

This repo includes `.github/workflows/deploy-infinityfree.yml`.

After the workflow is merged to `main`, every push to `main` will:

1. install dependencies with `npm ci`
2. build the Vite app with `npm run build`
3. upload the contents of `dist/` to InfinityFree `/htdocs/`

Add these repository Actions secrets before the first production deploy:

- `INFINITYFREE_FTP_SERVER` — the FTP host shown by InfinityFree
- `INFINITYFREE_FTP_USERNAME` — your InfinityFree FTP username
- `INFINITYFREE_FTP_PASSWORD` — your InfinityFree FTP password

The workflow can also be started manually from the repository's **Actions → Deploy to InfinityFree → Run workflow** screen.

Never commit FTP credentials to the repository.
