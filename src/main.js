import * as hb from 'harfbuzzjs';
import './style.css';
import { clearOutlineCache, buildMorph, ringsToPath } from './morph.js';
import { MAX_DT, scalar, stepPoints, stepScalar } from './spring.js';

const TITLE = 'មាន ភក្តី';
const SUBTITLE = 'MEAN PHEAKDEY';
const FONT_URL = 'https://raw.githubusercontent.com/seanghay/typing-morph/main/public/fonts/GoogleSans-Variable.ttf';

const STIFFNESS = 220;
const DAMPING = 29.7;
const EPS_POS = 0.18;
const EPS_VEL = 0.22;
const EPS_UNIT = 0.002;
const IDLE_MORPH_DELAY = 2300;

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const cameraWrap = document.getElementById('cameraWrap');
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
const centerGlow = document.getElementById('centerGlow');

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
let stageViewBox = null;
let morphSettled = false;
let renderDirty = true;
let lastMotionCss = '';

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
      easing: 'cubic-bezier(.20,.76,.24,1)',
      fill: 'forwards',
    },
  );
}

function burstParticles(progress = 0.5, finalBurst = false) {
  if (reduceMotion || !particleLayer) return;

  const seq = impactSeq++;
  if (!finalBurst && seq % 2 === 1) return;

  const count = finalBurst ? 10 : Math.max(2, Math.round(2 + progress * 2));
  const baseAngle = (seq * 47) * Math.PI / 180;

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
  if (reduceMotion || !centerGlow) return;

  const amount = Math.max(.18, 1 - progress * .55);
  centerGlow.getAnimations().forEach((animation) => animation.cancel());
  centerGlow.animate(
    [
      { opacity: .55, transform: 'translate(-50%, -50%) scale(.86)' },
      {
        opacity: .92,
        transform: `translate(-50%, -50%) scale(${(1.04 + amount * .18).toFixed(3)})`,
        offset: .28,
      },
      { opacity: .58, transform: 'translate(-50%, -50%) scale(.94)' },
    ],
    {
      duration: 460,
      easing: 'cubic-bezier(.22,1,.36,1)',
    },
  );
}

function showSubtitle() {
  subtitle.classList.remove('leaving');
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
  renderDirty = true;
  morphSettled = false;
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

  morphSettled = settled;
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

  renderDirty = false;
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

  pulseField(Math.max(.30, .72 - progress * .26));
  burstParticles(progress, false);
  exciteField(progress);
  svg.classList.remove('settled');

  const amplitude = Math.max(.18, 1 - progress * .72);
  const animation = svg.animate(
    [
      {
        transform: `translate3d(${(-2.1 * amplitude).toFixed(2)}px,${(3.2 * amplitude).toFixed(2)}px,0) scale(${(0.9975 + progress * .0015).toFixed(4)},${(1.0045 - progress * .0025).toFixed(4)})`,
      },
      {
        transform: `translate3d(${(.8 * amplitude).toFixed(2)}px,${(-.8 * amplitude).toFixed(2)}px,0) scale(1.0015,.9995)`,
        offset: .58,
      },
      { transform: 'translate3d(0,0,0) scale(1)' },
    ],
    {
      duration: 390,
      easing: 'cubic-bezier(.22,1,.36,1)',
      fill: 'none',
    },
  );

  currentMorphAnimation = animation;
  animation.finished.catch(() => {}).finally(() => {
    if (currentMorphAnimation === animation) currentMorphAnimation = null;
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

  const anim = cameraWrap.animate(
    [
      {
        opacity: .10,
        transform: 'translate3d(-1vw,20vh,0) rotate(-.48deg) scale(1.42)',
      },
      {
        opacity: .54,
        offset: .30,
        transform: 'translate3d(-.42vw,9vh,0) rotate(-.20deg) scale(1.20)',
      },
      {
        opacity: .94,
        offset: .70,
        transform: 'translate3d(.10vw,.8vh,0) rotate(.025deg) scale(1.012)',
      },
      {
        opacity: 1,
        transform: 'translate3d(0,0,0) rotate(0deg) scale(1)',
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

  const anim = cameraWrap.animate(
    [
      {
        opacity: 1,
        transform: 'translate3d(0,0,0) scale(1)',
      },
      {
        opacity: .98,
        offset: .28,
        transform: 'translate3d(.18vw,-.2vh,0) rotate(.02deg) scale(1.012)',
      },
      {
        opacity: .70,
        offset: .62,
        transform: 'translate3d(.55vw,7vh,0) rotate(.10deg) scale(1.10)',
      },
      {
        opacity: .06,
        transform: 'translate3d(-.8vw,28vh,0) rotate(-.32deg) scale(1.48)',
      },
    ],
    {
      duration: 940,
      easing: 'cubic-bezier(.4,0,.2,1)',
      fill: 'both',
    },
  );

  return anim.finished.catch(() => {});
}

async function storyboardPass() {
  const states = typingStates(TITLE);
  const splitAt = Math.max(2, Math.ceil((states.length - 1) * .46));
  const startedAt = performance.now();

  const waitTo = (targetMs) => new Promise((resolve) => {
    const target = startedAt + targetMs;
    const tick = (now) => {
      if (now >= target) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  finishedTyping = false;
  cinematicBusy = true;
  subtitle.classList.remove('visible', 'leaving');
  comingSoon.classList.remove('visible', 'leaving');
  svg.classList.remove('settled');

  // 01 — 0.0s → 0.8s / Ambient loading frame.
  setPhase('scene-1');
  applyPlan(layout('', { wght: 720 }), { echo: .18 });
  await waitTo(800);

  // 02 — 0.8s → 1.6s / Camera pushes into the orbital composition.
  setPhase('scene-2');
  const cameraEntry = cameraIn();
  await Promise.all([cameraEntry, waitTo(1600)]);

  // 03 — 1.6s → 2.4s / First Khmer forms enter.
  setPhase('scene-3');
  for (let i = 1; i <= splitAt; i++) {
    const progress = i / (states.length - 1);
    applyPlan(layout(states[i], { wght: 760 }), {
      echo: i === 1 || i % 2 === 0 ? Math.max(.16, .42 - progress * .12) : 0,
    });
    hitMorph(progress * .82);

    const sceneProgress = i / splitAt;
    await waitTo(1600 + sceneProgress * 760);
  }
  await waitTo(2400);

  // 04 — 2.4s → 3.2s / Sequential morph completes the name.
  setPhase('scene-4');
  const remaining = Math.max(1, states.length - 1 - splitAt);
  for (let i = splitAt + 1; i < states.length; i++) {
    const progress = i / (states.length - 1);
    applyPlan(layout(states[i], { wght: 760 }), {
      echo: i % 2 === 0 ? Math.max(.12, .34 - progress * .10) : 0,
    });
    hitMorph(progress);

    const sceneProgress = (i - splitAt) / remaining;
    await waitTo(2400 + sceneProgress * 760);
  }
  await waitTo(3200);

  // 05 — 3.2s → 4.0s / Final physical lock + strongest field response.
  setPhase('scene-5');
  applyPlan(layout(TITLE, { wght: 790 }), { echo: .28 });
  hitMorph(1);
  pulseField(1.18);
  burstParticles(1, true);
  await finishMorphImpact();
  await waitTo(4000);

  // 06 — 4.0s → 4.8s / Editorial reveal layer.
  setPhase('scene-6');
  runMotionSweep();
  showSubtitle();
  await waitTo(4250);
  showComingSoon();
  await waitTo(4800);

  // 07 — 4.8s → 6.4s / Premium living hold.
  setPhase('scene-7');
  svg.classList.remove('settled');
  requestAnimationFrame(() => svg.classList.add('settled'));
  lastWeightPlan = performance.now();
  targetWeight = 790;
  finishedTyping = true;
  cinematicBusy = false;
  await waitTo(6400);

  // 08 — 6.4s → 8.0s / Fade, camera release and reset.
  cinematicBusy = true;
  finishedTyping = false;
  setPhase('scene-8');

  spawnEcho(.7);
  const exit = cameraOut();
  const fade = Promise.all([
    hideSubtitle(),
    hideComingSoon(),
  ]);

  await waitTo(7020);
  applyPlan(layout('', { wght: 730 }), { echo: .34 });

  await Promise.all([exit, fade]);
  await waitTo(8000);
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
  const rawDt = Math.min(1 / 20, Math.max(0, (now - last) / 1000));
  last = now;

  const substep = 1 / 120;
  const steps = Math.max(1, Math.ceil(rawDt / substep));
  const dt = rawDt / steps;

  let settled = true;
  for (let i = 0; i < steps; i++) {
    if (!advance(dt)) settled = false;
  }

  if (!settled || renderDirty) {
    render();
  }

  updateIdleMorph(now);

  const t = (now - started) / 1000;
  if (!pointerActive) {
    targetX = innerWidth * .5 + Math.cos(t * .24) * innerWidth * .026;
    targetY = innerHeight * .5 + Math.sin(t * .31) * innerHeight * .019;
  }

  const pointerEase = 1 - Math.exp(-rawDt * 3.5);
  pointerX += (targetX - pointerX) * pointerEase;
  pointerY += (targetY - pointerY) * pointerEase;

  const nx = pointerX / Math.max(1, innerWidth) - .5;
  const ny = pointerY / Math.max(1, innerHeight) - .5;

  const energyEase = 1 - Math.exp(-rawDt * 7.2);
  pointerEnergy += (targetPointerEnergy - pointerEnergy) * energyEase;
  targetPointerEnergy *= Math.exp(-rawDt * 8.2);

  const motionCss = [
    `--energy:${pointerEnergy.toFixed(3)}`,
    `--field-rot:${(nx * .34 - ny * .20).toFixed(3)}deg`,
    `--field-scale:${(1 + pointerEnergy * .005).toFixed(4)}`,
    `--tilt-x:${(-ny * (.52 + pointerEnergy * .16)).toFixed(3)}deg`,
    `--tilt-y:${(nx * (.62 + pointerEnergy * .18)).toFixed(3)}deg`,
    `--field-x:${(nx * -11).toFixed(2)}px`,
    `--field-y:${(ny * -8).toFixed(2)}px`,
    `--focus-x:${(50 + nx * 7).toFixed(2)}%`,
    `--focus-y:${(50 + ny * 5).toFixed(2)}%`,
  ].join(';');

  if (motionCss !== lastMotionCss) {
    document.documentElement.style.cssText = motionCss;
    lastMotionCss = motionCss;
  }

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

    const stableLayout = layout(TITLE, { wght: 810 });
    const asc = extents?.ascender ?? upem * 0.8;
    const desc = extents?.descender ?? -upem * 0.2;
    const padX = upem * 0.42;
    const padY = upem * 0.22;
    const contentWidth = Math.max(stableLayout.width, upem * 1.25);
    stageViewBox = `${-padX} ${-asc - padY} ${contentWidth + padX * 2} ${asc - desc + padY * 2}`;
    svg.setAttribute('viewBox', stageViewBox);

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
