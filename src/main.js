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
const motionField = document.getElementById('motionField');
const particleLayer = document.getElementById('particleLayer');
const motionSweep = document.getElementById('motionSweep');
const sceneNumber = document.getElementById('sceneNumber');

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
let impactSeq = 0;

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

  const match = /^scene-(\d+)$/.exec(phase);
  if (match && sceneNumber) {
    sceneNumber.textContent = String(Number(match[1])).padStart(2, '0');
  }
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

function burstParticles(progress = 0.5, finalBurst = false) {
  if (reduceMotion || !particleLayer) return;

  const count = finalBurst ? 14 : Math.max(3, Math.round(3 + progress * 4));
  const baseAngle = (impactSeq++ * 47) * Math.PI / 180;

  for (let i = 0; i < count; i++) {
    const particle = document.createElement('span');
    particle.className = 'impact-particle';

    if ((i + impactSeq) % 4 === 0 || (finalBurst && i % 3 === 0)) {
      particle.classList.add('impact-particle--accent');
    }

    const angle = baseAngle + (Math.PI * 2 * i) / count + Math.sin(i * 1.7) * .12;
    const distance = finalBurst
      ? 66 + (i % 5) * 15
      : 28 + progress * 40 + (i % 3) * 9;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance * .62;
    const size = finalBurst ? 2 + (i % 3) : 1.5 + (i % 2) * 1.2;

    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particleLayer.appendChild(particle);

    const animation = particle.animate(
      [
        {
          opacity: 0,
          transform: 'translate3d(0,0,0) scale(.25)',
        },
        {
          opacity: finalBurst ? .82 : .5,
          offset: .16,
          transform: `translate3d(${(dx * .12).toFixed(1)}px,${(dy * .12).toFixed(1)}px,0) scale(1)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${dx.toFixed(1)}px,${dy.toFixed(1)}px,0) scale(.15)`,
        },
      ],
      {
        duration: finalBurst ? 980 + (i % 4) * 70 : 520 + (i % 3) * 55,
        delay: finalBurst ? i * 12 : i * 8,
        easing: 'cubic-bezier(.16,1,.3,1)',
        fill: 'forwards',
      },
    );

    animation.finished.catch(() => {}).finally(() => particle.remove());
  }
}

function runMotionSweep() {
  if (reduceMotion || !motionSweep) return;

  motionSweep.getAnimations().forEach((animation) => animation.cancel());

  motionSweep.animate(
    [
      {
        opacity: 0,
        transform: 'translate3d(-62vw,-2vh,0) rotate(-16deg) scaleX(.58)',
      },
      {
        opacity: .36,
        offset: .30,
      },
      {
        opacity: .13,
        offset: .68,
      },
      {
        opacity: 0,
        transform: 'translate3d(62vw,2vh,0) rotate(-16deg) scaleX(1.08)',
      },
    ],
    {
      duration: 1080,
      easing: 'cubic-bezier(.16,1,.3,1)',
      fill: 'forwards',
    },
  );
}

function exciteField(progress = .5) {
  if (reduceMotion || !motionField) return;

  const amount = Math.max(.18, 1 - progress * .55);
  motionField.getAnimations().forEach((animation) => {
    if (animation.id === 'impact-field') animation.cancel();
  });

  const animation = motionField.animate(
    [
      { filter: 'blur(0px) contrast(1)' },
      {
        filter: `blur(${(.32 * amount).toFixed(2)}px) contrast(${(1 + .06 * amount).toFixed(3)})`,
        offset: .24,
      },
      { filter: 'blur(0px) contrast(1)' },
    ],
    {
      duration: 620,
      easing: 'cubic-bezier(.16,1,.3,1)',
    },
  );
  animation.id = 'impact-field';
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
  burstParticles(progress, false);
  exciteField(progress);
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
        opacity: .08,
        transform: 'translate3d(-1.8vw,34vh,0) rotate(-.9deg) scale(1.72)',
        filter: 'blur(4.2px)',
      },
      {
        opacity: .48,
        offset: .24,
        transform: 'translate3d(-.8vw,18vh,0) rotate(-.42deg) scale(1.38)',
        filter: 'blur(1.7px)',
      },
      {
        opacity: .94,
        offset: .64,
        transform: 'translate3d(.22vw,1.4vh,0) rotate(.08deg) scale(1.018)',
        filter: 'blur(.18px)',
      },
      {
        opacity: 1,
        offset: .84,
        transform: 'translate3d(-.05vw,-.35vh,0) rotate(-.02deg) scale(.996)',
        filter: 'blur(0)',
      },
      {
        opacity: 1,
        transform: 'translate3d(0,0,0) rotate(0deg) scale(1)',
        filter: 'blur(0)',
      },
    ],
    {
      duration: 780,
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
        opacity: .98,
        offset: .20,
        transform: 'translate3d(.45vw,-.4vh,0) rotate(.05deg) scale(1.018)',
        filter: 'blur(.1px)',
      },
      {
        opacity: .68,
        offset: .52,
        transform: 'translate3d(1.1vw,10vh,0) rotate(.22deg) scale(1.18)',
        filter: 'blur(.8px)',
      },
      {
        opacity: .08,
        transform: 'translate3d(-1.7vw,48vh,0) rotate(-.72deg) scale(1.82)',
        filter: 'blur(5.2px)',
      },
    ],
    {
      duration: 940,
      easing: 'cubic-bezier(.72,0,.18,1)',
      fill: 'both',
    },
  );

  return anim.finished.catch(() => {});
}

async function storyboardPass() {
  const states = typingStates(TITLE);
  const splitAt = Math.max(2, Math.ceil((states.length - 1) * .46));

  finishedTyping = false;
  cinematicBusy = true;
  subtitle.classList.remove('visible', 'leaving');
  comingSoon.classList.remove('visible', 'leaving');
  svg.classList.remove('settled');

  // 01 — 0.0s → 0.8s / Ambient loading frame.
  setPhase('scene-1');
  applyPlan(layout('', { wght: 720 }), { echo: .18 });
  await sleep(800);

  // 02 — 0.8s → 1.6s / Camera pushes into the orbital composition.
  setPhase('scene-2');
  await cameraIn();

  // 03 — 1.6s → 2.4s / First Khmer forms enter.
  setPhase('scene-3');
  for (let i = 1; i <= splitAt; i++) {
    const progress = i / (states.length - 1);
    applyPlan(layout(states[i], { wght: 650 + progress * 95 }), {
      echo: Math.max(.24, .66 - progress * .18),
    });
    hitMorph(progress * .82);
    await sleep(Math.max(92, 760 / splitAt));
  }

  // 04 — 2.4s → 3.2s / Sequential morph completes the name.
  setPhase('scene-4');
  const remaining = Math.max(1, states.length - 1 - splitAt);
  for (let i = splitAt + 1; i < states.length; i++) {
    const progress = i / (states.length - 1);
    applyPlan(layout(states[i], { wght: 700 + progress * 70 }), {
      echo: Math.max(.18, .52 - progress * .2),
    });
    hitMorph(progress);
    await sleep(Math.max(92, 760 / remaining));
  }

  // 05 — 3.2s → 4.0s / Final physical lock + strongest field response.
  setPhase('scene-5');
  applyPlan(layout(TITLE, { wght: 790 }), { echo: .28 });
  hitMorph(1);
  pulseField(1.18);
  burstParticles(1, true);
  await finishMorphImpact();
  await sleep(380);

  // 06 — 4.0s → 4.8s / Editorial reveal layer.
  setPhase('scene-6');
  runMotionSweep();
  showSubtitle();
  await sleep(250);
  showComingSoon();
  await sleep(550);

  // 07 — 4.8s → 6.4s / Premium living hold.
  setPhase('scene-7');
  svg.classList.remove('settled');
  void svg.getBoundingClientRect();
  svg.classList.add('settled');
  lastWeightPlan = performance.now();
  targetWeight = 790;
  finishedTyping = true;
  cinematicBusy = false;
  await sleep(1600);

  // 08 — 6.4s → 8.0s / Fade, camera release and reset.
  cinematicBusy = true;
  finishedTyping = false;
  setPhase('scene-8');

  await Promise.all([
    hideSubtitle(),
    hideComingSoon(),
  ]);

  spawnEcho(.7);
  const exit = cameraOut();
  await sleep(620);
  applyPlan(layout('', { wght: 730 }), { echo: .34 });
  await exit;
  await sleep(260);
}

async function cinematicLoop() {
  const myToken = ++loopToken;

  while (myToken === loopToken) {
    await storyboardPass();
    if (myToken !== loopToken) break;
  }
}

function updateIdleMorph(now) {
  if (!finishedTyping || cinematicBusy) return;
  if (now - lastWeightPlan < IDLE_MORPH_DELAY) return;

  // Keep the post-intro weight motion subtle. Large 610↔860 jumps
  // looked like a second unintended morph immediately after settling.
  targetWeight = targetWeight > 790 ? 766 : 808;
  applyPlan(layout(TITLE, { wght: targetWeight }), { echo: .035 });
  lastWeightPlan = now;
}

let pointerX = innerWidth / 2;
let pointerY = innerHeight / 2;
let targetX = pointerX;
let targetY = pointerY;
let pointerActive = false;
let pointerEnergy = 0;
let targetPointerEnergy = 0;
let lastPointerEventX = pointerX;
let lastPointerEventY = pointerY;

addEventListener('pointermove', (e) => {
  pointerActive = true;

  const dx = e.clientX - lastPointerEventX;
  const dy = e.clientY - lastPointerEventY;
  const distance = Math.hypot(dx, dy);

  targetPointerEnergy = Math.max(
    targetPointerEnergy,
    Math.min(1, distance / 42),
  );

  lastPointerEventX = e.clientX;
  lastPointerEventY = e.clientY;
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

  const energyEase = 1 - Math.exp(-dt * 8.5);
  pointerEnergy += (targetPointerEnergy - pointerEnergy) * energyEase;
  targetPointerEnergy *= Math.exp(-dt * 7.5);

  document.documentElement.style.setProperty('--energy', pointerEnergy.toFixed(3));
  document.documentElement.style.setProperty('--field-rot', `${(nx * .45 - ny * .28).toFixed(3)}deg`);
  document.documentElement.style.setProperty('--field-scale', (1 + pointerEnergy * .008).toFixed(4));
  document.documentElement.style.setProperty('--tilt-x', `${(-ny * (.72 + pointerEnergy * .28)).toFixed(3)}deg`);
  document.documentElement.style.setProperty('--tilt-y', `${(nx * (.84 + pointerEnergy * .30)).toFixed(3)}deg`);
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
      applyPlan(layout(TITLE, { wght: 790 }));
      subtitle.classList.add('visible');
      comingSoon.classList.add('visible');
      setPhase('scene-7');
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
