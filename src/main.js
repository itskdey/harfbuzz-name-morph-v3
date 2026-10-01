import * as hb from 'harfbuzzjs';
import './style.css';
import { clearOutlineCache, buildMorph, ringsToPath } from './morph.js';
import { MAX_DT, scalar, stepPoints, stepScalar } from './spring.js';

const TITLE = 'មាន ភក្តី';
const SUBTITLE = 'MEAN PHEAKDEY';
const FONT_URL = 'https://raw.githubusercontent.com/seanghay/typing-morph/main/public/fonts/GoogleSans-Variable.ttf';

const STIFFNESS = 270;
const DAMPING = 29;
const EPS_POS = 0.4;
const EPS_VEL = 0.4;
const EPS_UNIT = 0.002;
const IDLE_MORPH_DELAY = 2300;

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const wrap = document.getElementById('morphWrap');
const svg = document.getElementById('morphStage');
const echoLayer = document.getElementById('echoLayer');
const layer = document.getElementById('glyphLayer');
const subtitle = document.getElementById('subtitle');
const status = document.getElementById('status');
const comingSoon = document.getElementById('comingSoon');
const comingTitle = document.getElementById('comingTitle');
const impactPulse = document.getElementById('impactPulse');

let font;
let face;
let blob;
let upem = 1000;
let extents = { ascender: 800, descender: -200 };
let variationKey = '';
let finishedTyping = false;
let cinematicBusy = false;
let lastWeightPlan = 0;
let targetWeight = 780;
let currentMorphAnimation = null;
let loopToken = 0;

const pathEls = new Map();

const store = {
  clusters: new Map(),
  width: scalar(0, 0),
  glyphs: [],
  seq: 0,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSubtitle() {
  subtitle.innerHTML = '';
  const chars = Array.from(SUBTITLE);

  chars.forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = 'subtitle-char';
    span.textContent = ch;
    span.style.setProperty('--i', i);
    span.style.setProperty('--ri', chars.length - 1 - i);
    subtitle.appendChild(span);
  });
}

function buildComingSoon() {
  const text = 'COMING SOON';
  comingTitle.innerHTML = '';
  const chars = Array.from(text);

  chars.forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = 'coming-char';
    span.textContent = ch;
    span.style.setProperty('--i', i);
    span.style.setProperty('--ri', chars.length - 1 - i);
    comingTitle.appendChild(span);
  });
}

function setPhase(phase) {
  document.body.dataset.phase = phase;
}

function showComingSoon() {
  comingSoon.classList.remove('leaving');
  void comingSoon.offsetWidth;
  comingSoon.classList.add('visible');
}

async function hideComingSoon() {
  comingSoon.classList.remove('visible');
  comingSoon.classList.add('leaving');
  if (!reduceMotion) await sleep(380);
}

function pulseField(intensity = 1) {
  if (reduceMotion || !impactPulse) return;

  impactPulse.getAnimations().forEach((animation) => animation.cancel());
  impactPulse.animate(
    [
      {
        opacity: .22 * intensity,
        transform: 'translate(-50%, -50%) scale(.4)',
      },
      {
        opacity: .10 * intensity,
        offset: .45,
        transform: 'translate(-50%, -50%) scale(1.35)',
      },
      {
        opacity: 0,
        transform: 'translate(-50%, -50%) scale(2.4)',
      },
    ],
    {
      duration: 900,
      easing: 'cubic-bezier(.16,1,.3,1)',
      fill: 'forwards',
    },
  );
}

function showSubtitle() {
  subtitle.classList.remove('leaving');
  void subtitle.offsetWidth;
  subtitle.classList.add('visible');
}

async function hideSubtitle() {
  subtitle.classList.remove('visible');
  subtitle.classList.add('leaving');
  if (!reduceMotion) await sleep(330);
}

function setVariations(variations) {
  const key = Object.entries(variations)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, value]) => `${tag}=${value}`)
    .join(',');

  if (key === variationKey) return;

  font.setVariations(
    Object.entries(variations).map(([tag, value]) => new hb.Variation(tag, value)),
  );

  variationKey = key;
  clearOutlineCache();
}

function layout(text, variations = { wght: 760 }) {
  if (!text) return { glyphs: [], width: 0, upem };

  setVariations(variations);

  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(font, buffer);

  const infos = buffer.getGlyphInfosAndPositions();
  const glyphs = [];
  let penX = 0;
  let penY = 0;

  for (let i = 0; i < infos.length; i++) {
    const g = infos[i];

    glyphs.push({
      index: i,
      gid: g.codepoint,
      cluster: g.cluster,
      x: penX + (g.xOffset ?? 0),
      y: penY + (g.yOffset ?? 0),
      xAdvance: g.xAdvance ?? 0,
      yAdvance: g.yAdvance ?? 0,
      xOffset: g.xOffset ?? 0,
      yOffset: g.yOffset ?? 0,
    });

    penX += g.xAdvance ?? 0;
    penY += g.yAdvance ?? 0;
  }

  buffer.destroy?.();
  return { glyphs, width: penX, upem };
}

function glyphCommands(gid) {
  return font.glyphToJson(gid);
}

function seedRing(ring) {
  return {
    pos: Float64Array.from(ring.a),
    vel: new Float64Array(ring.a.length),
    target: ring.b,
  };
}

function spawnEcho(strength = 1) {
  if (reduceMotion || pathEls.size === 0) return;

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.style.transformBox = 'fill-box';
  group.style.transformOrigin = '50% 55%';
  group.style.pointerEvents = 'none';

  for (const el of pathEls.values()) {
    const clone = el.cloneNode(false);
    clone.setAttribute('fill-opacity', String(0.10 * strength));
    group.appendChild(clone);
  }

  echoLayer.appendChild(group);

  const drift = 5 + strength * 8;
  group.animate(
    [
      { opacity: 0.26 * strength, transform: 'translate3d(0,0,0) scale(1)' },
      { opacity: 0.07 * strength, offset: 0.48, transform: `translate3d(0,${-drift * .35}px,0) scale(1.008)` },
      { opacity: 0, transform: `translate3d(0,${-drift}px,0) scale(1.025)` },
    ],
    {
      duration: 620,
      easing: 'cubic-bezier(.16,1,.3,1)',
      fill: 'forwards',
    },
  ).finished.finally(() => group.remove());
}

function applyPlan(nextLayout, { echo = 0 } = {}) {
  if (echo) spawnEcho(echo);

  const from = { glyphs: store.glyphs, width: store.width.pos };

  const shapes = buildMorph(from.glyphs, nextLayout.glyphs, {
    upem: nextLayout.upem,
    commandsFor: glyphCommands,
  });

  const liveClusters = new Set();

  for (const shape of shapes) {
    liveClusters.add(shape.cluster);

    let entry = store.clusters.get(shape.cluster);
    if (!entry) {
      entry = {
        rings: new Map(),
        opacity: scalar(shape.fromOpacity, shape.toOpacity),
      };
      store.clusters.set(shape.cluster, entry);
    }

    entry.opacity.target = shape.toOpacity;
    const next = new Map();

    for (const ring of shape.rings) {
      const existing = ring.fromKey === null ? undefined : entry.rings.get(ring.fromKey);

      if (existing) {
        existing.target = ring.b;
        entry.rings.delete(ring.fromKey);
      }

      next.set(ring.toKey ?? `x${store.seq++}`, existing ?? seedRing(ring));
    }

    for (const [key, ring] of entry.rings) {
      if (String(key)[0] === 'x') next.set(key, ring);
    }

    entry.rings = next;
  }

  for (const [cluster, entry] of store.clusters) {
    if (!liveClusters.has(cluster)) entry.opacity.target = 0;
  }

  store.width.target = nextLayout.width;
  store.glyphs = nextLayout.glyphs;
}

function advance(dt) {
  let settled = stepScalar(store.width, STIFFNESS, DAMPING, dt, EPS_POS, EPS_VEL);

  for (const [cluster, entry] of store.clusters) {
    for (const [key, ring] of entry.rings) {
      const done = stepPoints(
        ring.pos,
        ring.vel,
        ring.target,
        STIFFNESS,
        DAMPING,
        dt,
        EPS_POS,
        EPS_VEL,
      );

      if (!done) settled = false;
      else if (String(key)[0] === 'x') entry.rings.delete(key);
    }

    if (!stepScalar(entry.opacity, STIFFNESS, DAMPING, dt, EPS_UNIT, EPS_UNIT)) {
      settled = false;
    }

    if (entry.opacity.target === 0 && entry.opacity.pos <= EPS_UNIT) {
      store.clusters.delete(cluster);
    }
  }

  return settled;
}

function currentPaths() {
  const paths = [];

  for (const [cluster, entry] of store.clusters) {
    if (entry.opacity.pos <= EPS_UNIT) continue;

    const groups = new Map();

    for (const [key, ring] of entry.rings) {
      const stringKey = String(key);
      const split = stringKey.indexOf(':');
      const glyph = split === -1 ? null : Number(stringKey.slice(0, split));
      const id = `${cluster}:${glyph ?? stringKey}`;
      const group = groups.get(id);

      if (group) group.rings.push(ring);
      else groups.set(id, { id, rings: [ring] });
    }

    for (const group of groups.values()) {
      paths.push({
        id: group.id,
        d: ringsToPath(group.rings),
        opacity: entry.opacity.pos,
      });
    }
  }

  return paths;
}

function render() {
  const paths = currentPaths();
  const live = new Set(paths.map((p) => p.id));

  for (const p of paths) {
    let el = pathEls.get(p.id);

    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('fill-rule', 'nonzero');
      layer.appendChild(el);
      pathEls.set(p.id, el);
    }

    el.setAttribute('d', p.d);
    el.setAttribute('fill-opacity', Math.max(0, Math.min(1, p.opacity)).toFixed(3));
  }

  for (const [id, el] of pathEls) {
    if (!live.has(id)) {
      el.remove();
      pathEls.delete(id);
    }
  }

  const asc = extents?.ascender ?? upem * 0.8;
  const desc = extents?.descender ?? -upem * 0.2;
  const padX = upem * 0.38;
  const padY = upem * 0.20;
  const contentWidth = Math.max(store.width.pos, upem * 1.25);
  const viewWidth = contentWidth + padX * 2;
  const viewHeight = asc - desc + padY * 2;

  svg.setAttribute('viewBox', `${-padX} ${-asc - padY} ${viewWidth} ${viewHeight}`);
}

function typingStates(text) {
  const units = [];
  const chars = Array.from(text);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (ch.codePointAt(0) === 0x17D2 && i + 1 < chars.length) {
      units.push(ch + chars[++i]);
    } else {
      units.push(ch);
    }
  }

  const states = [''];
  let acc = '';

  for (const unit of units) {
    acc += unit;
    states.push(acc);
  }

  return states;
}

function hitMorph(progress = 0.5) {
  if (reduceMotion) return null;

  pulseField(Math.max(.35, 1 - progress * .45));
  svg.classList.remove('settled');

  if (currentMorphAnimation) {
    currentMorphAnimation.cancel();
    currentMorphAnimation = null;
  }

  const amplitude = 1 - progress;
  const animation = svg.animate(
    [
      {
        transform: `translate3d(${(-10 * amplitude).toFixed(1)}px,${(18 * amplitude).toFixed(1)}px,0) scale(${(0.988 + progress * .008).toFixed(3)},${(1.028 - progress * .012).toFixed(3)})`,
      },
      {
        transform: `translate3d(${(3.5 * amplitude).toFixed(1)}px,${(-3.5 * amplitude).toFixed(1)}px,0) scale(1.005,.998)`,
        offset: .56,
      },
      { transform: 'translate3d(0,0,0) scale(1)' },
    ],
    {
      duration: 560,
      easing: 'cubic-bezier(.16,1,.3,1)',
      fill: 'none',
    },
  );

  currentMorphAnimation = animation;

  animation.finished
    .catch(() => {})
    .finally(() => {
      if (currentMorphAnimation === animation) {
        currentMorphAnimation = null;
      }
    });

  return animation;
}

async function finishMorphImpact() {
  const animation = currentMorphAnimation;
  if (!animation) return;

  try {
    await animation.finished;
  } catch {
    // A newer shaping step may cancel the previous impact animation.
  }

  if (currentMorphAnimation === animation) {
    currentMorphAnimation = null;
  }

  // Force a clean transform baseline before the idle motion takes over.
  svg.style.transform = '';
}

function cameraIn() {
  if (reduceMotion) return Promise.resolve();

  const anim = wrap.animate(
    [
      {
        opacity: .06,
        transform: 'translate3d(-3vw,52vh,0) rotate(-1.4deg) scale(2.15)',
        filter: 'blur(6px)',
      },
      {
        opacity: .55,
        offset: .34,
        transform: 'translate3d(-1.2vw,23vh,0) rotate(-.55deg) scale(1.58)',
        filter: 'blur(1.8px)',
      },
      {
        opacity: 1,
        offset: .78,
        transform: 'translate3d(.25vw,-1.5vh,0) rotate(.08deg) scale(.985)',
        filter: 'blur(0)',
      },
      {
        opacity: 1,
        transform: 'translate3d(0,0,0) rotate(0deg) scale(1)',
        filter: 'blur(0)',
      },
    ],
    {
      duration: 1820,
      easing: 'cubic-bezier(.16,1,.3,1)',
      fill: 'both',
    },
  );

  return anim.finished.catch(() => {});
}

function cameraOut() {
  if (reduceMotion) return Promise.resolve();

  const anim = wrap.animate(
    [
      {
        opacity: 1,
        transform: 'translate3d(0,0,0) scale(1)',
        filter: 'blur(0)',
      },
      {
        opacity: .95,
        offset: .28,
        transform: 'translate3d(1vw,5vh,0) rotate(.15deg) scale(1.08)',
        filter: 'blur(.2px)',
      },
      {
        opacity: .12,
        transform: 'translate3d(-2vw,62vh,0) rotate(-.9deg) scale(2.35)',
        filter: 'blur(7px)',
      },
    ],
    {
      duration: 760,
      easing: 'cubic-bezier(.72,0,.18,1)',
      fill: 'both',
    },
  );

  return anim.finished.catch(() => {});
}

async function typePass({ cinematic = true } = {}) {
  finishedTyping = false;
  cinematicBusy = true;
  setPhase('intro');
  svg.classList.remove('settled');
  comingSoon.classList.remove('visible', 'leaving');

  const states = typingStates(TITLE);

  applyPlan(layout('', { wght: 760 }), { echo: .65 });
  await sleep(cinematic ? 110 : 40);

  const camera = cinematic ? cameraIn() : Promise.resolve();

  for (let i = 1; i < states.length; i++) {
    const progress = i / (states.length - 1);
    const weight = 690 + progress * 70;

    applyPlan(layout(states[i], { wght: weight }), {
      echo: i > 1 ? Math.max(.28, .72 - progress * .30) : .18,
    });

    hitMorph(progress);

    const base = cinematic ? 118 : 155;
    const extra = states[i].endsWith(' ') ? -45 : Math.random() * 35;
    await sleep(Math.max(72, base + extra));
  }

  await camera;
  await sleep(230);

  applyPlan(layout(TITLE, { wght: 780 }), { echo: .18 });
  hitMorph(1);

  // Let the final physical impact reach exactly zero before handing
  // transform control to the idle animation. This prevents the end jump.
  await finishMorphImpact();
  await sleep(90);

  showSubtitle();
  await sleep(260);
  showComingSoon();
  setPhase('hold');

  // Start the idle animation from a true zero transform.
  svg.classList.remove('settled');
  void svg.getBoundingClientRect();
  svg.classList.add('settled');

  lastWeightPlan = performance.now();
  targetWeight = 780;
  finishedTyping = true;
  cinematicBusy = false;
}

async function cinematicLoop() {
  const myToken = ++loopToken;

  await typePass({ cinematic: true });

  while (myToken === loopToken) {
    await sleep(3100);
    if (myToken !== loopToken) break;

    cinematicBusy = true;
    finishedTyping = false;
    setPhase('exit');

    await Promise.all([
      hideSubtitle(),
      hideComingSoon(),
    ]);

    spawnEcho(.9);
    pulseField(.9);
    await cameraOut();

    applyPlan(layout('', { wght: 760 }), { echo: .5 });
    await sleep(180);

    if (myToken !== loopToken) break;
    await typePass({ cinematic: true });
  }
}

function updateIdleMorph(now) {
  if (!finishedTyping || cinematicBusy) return;
  if (now - lastWeightPlan < IDLE_MORPH_DELAY) return;

  // Keep the post-intro weight motion subtle. Large 610↔860 jumps
  // looked like a second unintended morph immediately after settling.
  targetWeight = targetWeight > 780 ? 742 : 818;
  applyPlan(layout(TITLE, { wght: targetWeight }), { echo: .035 });
  lastWeightPlan = now;
}

let pointerX = innerWidth / 2;
let pointerY = innerHeight / 2;
let targetX = pointerX;
let targetY = pointerY;
let pointerActive = false;

addEventListener('pointermove', (e) => {
  pointerActive = true;
  targetX = e.clientX;
  targetY = e.clientY;
}, { passive: true });

document.addEventListener('pointerleave', () => {
  pointerActive = false;
});

let last = performance.now();
const started = last;

function frame(now) {
  const dt = Math.min(MAX_DT, (now - last) / 1000);
  last = now;

  advance(dt);
  render();
  updateIdleMorph(now);

  const t = (now - started) / 1000;

  if (!pointerActive) {
    targetX = innerWidth * .5 + Math.cos(t * .27) * innerWidth * .035;
    targetY = innerHeight * .5 + Math.sin(t * .35) * innerHeight * .025;
  }

  const ease = 1 - Math.exp(-dt * 4.1);
  pointerX += (targetX - pointerX) * ease;
  pointerY += (targetY - pointerY) * ease;

  const nx = pointerX / Math.max(1, innerWidth) - .5;
  const ny = pointerY / Math.max(1, innerHeight) - .5;

  document.documentElement.style.setProperty('--tilt-x', `${(-ny * .72).toFixed(3)}deg`);
  document.documentElement.style.setProperty('--tilt-y', `${(nx * .84).toFixed(3)}deg`);
  document.documentElement.style.setProperty('--field-x', `${(nx * -16).toFixed(2)}px`);
  document.documentElement.style.setProperty('--field-y', `${(ny * -12).toFixed(2)}px`);
  document.documentElement.style.setProperty('--focus-x', `${(50 + nx * 10).toFixed(2)}%`);
  document.documentElement.style.setProperty('--focus-y', `${(50 + ny * 8).toFixed(2)}%`);

  requestAnimationFrame(frame);
}

async function init() {
  try {
    buildSubtitle();
    buildComingSoon();
    setPhase('loading');

    const fontData = await fetch(FONT_URL).then((r) => {
      if (!r.ok) throw new Error(`Font request failed: ${r.status}`);
      return r.arrayBuffer();
    });

    blob = new hb.Blob(fontData);
    face = new hb.Face(blob, 0);
    font = new hb.Font(face);
    upem = face.upem;
    font.setScale(upem, upem);
    extents = font.hExtents();

    requestAnimationFrame(frame);
    await sleep(180);

    if (reduceMotion) {
      applyPlan(layout(TITLE, { wght: 780 }));
      subtitle.classList.add('visible');
      comingSoon.classList.add('visible');
      setPhase('hold');
      finishedTyping = true;
      return;
    }

    cinematicLoop();
  } catch (error) {
    console.error(error);
    status.textContent = `Could not start HarfBuzz: ${error.message}`;
    status.classList.add('error');
  }
}

init();
