import * as hb from 'harfbuzzjs';
import './style.css';
import { clearOutlineCache, buildMorph, ringsToPath } from './morph.js';
import { MAX_DT, scalar, stepPoints, stepScalar } from './spring.js';

const TITLE = 'មាន ភក្តី';
const SUBTITLE = 'MEAN PHEAKDEY';

const MORPH_STATES = [
  '',
  'ម',
  'មា',
  'មាន',
  'មាន ',
  'មាន ភ',
  'មាន ភក',
  'មាន ភក្',
  'មាន ភក្ត',
  'មាន ភក្តី',
];
const FONT_URL = 'https://raw.githubusercontent.com/seanghay/typing-morph/main/public/fonts/GoogleSans-Variable.ttf';

const STIFFNESS = 220;
const DAMPING = 29.7;
const EPS_POS = 0.18;
const EPS_VEL = 0.22;
const EPS_UNIT = 0.002;
const LOOP_DURATION = 8000;

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
const motionSweep = document.getElementById('motionSweep');
const sceneNumber = document.getElementById('sceneNumber');
const centerGlow = document.getElementById('centerGlow');

let font;
let face;
let blob;
let upem = 1000;
let extents = { ascender: 800, descender: -200 };
let variationKey = '';
let currentMorphAnimation = null;
let stageViewBox = null;
let morphSettled = false;
let renderDirty = true;
let lastMotionCss = '';
let timelineReady = false;
let timelineStart = 0;
let timelineCycle = -1;
let timelineMs = 0;
let currentScene = 0;
let nextTimelineEvent = 0;
let timelineEvents = [];
let timelineLayouts = [];

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

function typingStates() {
  return MORPH_STATES;
}

function hitMorph(progress = 0.5) {
  if (reduceMotion) return null;

  pulseField(Math.max(.18, .42 - progress * .12));
  exciteField(progress);
  svg.classList.remove('settled');

  const amplitude = Math.max(.10, .42 - progress * .22);
  const animation = svg.animate(
    [
      {
        transform: `translate3d(${(-.72 * amplitude).toFixed(2)}px,${(1.05 * amplitude).toFixed(2)}px,0) scale(.9995,1.0005)`,
      },
      {
        transform: `translate3d(${(.28 * amplitude).toFixed(2)}px,${(-.20 * amplitude).toFixed(2)}px,0) scale(1.0002,.9998)`,
        offset: .58,
      },
      { transform: 'translate3d(0,0,0) scale(1)' },
    ],
    {
      duration: 300,
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

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeOutQuint(t) {
  t = clamp01(t);
  return 1 - Math.pow(1 - t, 5);
}

function easeInOutCubic(t) {
  t = clamp01(t);
  return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function setScene(scene) {
  if (scene === currentScene) return;
  currentScene = scene;
  setPhase(`scene-${scene}`);
}

function sceneForTime(ms) {
  if (ms < 500) return 1;
  if (ms < 1200) return 2;
  if (ms < 2000) return 3;
  if (ms < 3000) return 4;
  if (ms < 4000) return 5;
  if (ms < 4800) return 6;
  if (ms < 5600) return 7;
  if (ms < 7000) return 8;
  if (ms < 7500) return 9;
  return 10;
}

function resetTimelineCycle(cycle) {
  timelineCycle = cycle;
  nextTimelineEvent = 0;
  currentScene = 0;

  subtitle.classList.remove('visible', 'leaving');
  comingSoon.classList.remove('visible', 'leaving');
  svg.classList.remove('settled');
  cameraWrap.getAnimations().forEach((animation) => animation.cancel());
  svg.getAnimations().forEach((animation) => animation.cancel());
  currentMorphAnimation = null;

  applyPlan(timelineLayouts[0], { echo: 0 });
  setScene(1);
}

function buildTimeline() {
  const states = typingStates();
  timelineLayouts = states.map((text) => layout(text, { wght: 780 }));

  const events = [
    {
      time: 0,
      run: () => applyPlan(timelineLayouts[0], { echo: 0 }),
    },
  ];

  // Exact cumulative Khmer component build:
  // ម → មា → មាន → [space] → ភ → ភក → ភក្ → ភក្ត → ភក្តី
  const morphStart = 1180;
  const morphEnd = 3180;
  const visibleSteps = timelineLayouts.length - 1;

  for (let i = 1; i < timelineLayouts.length; i++) {
    const local = i / visibleSteps;
    const progress = i / visibleSteps;

    events.push({
      time: morphStart + local * (morphEnd - morphStart),
      run: () => {
        applyPlan(timelineLayouts[i], {
          echo: i === 1 || i === 3 || i === 5 || i === 9 ? .10 : 0,
        });
        hitMorph(progress);
      },
    });
  }

  events.push({
    time: 3260,
    run: () => {
      pulseField(.62);
      spawnEcho(.14);
    },
  });

  events.push({
    time: 4000,
    run: () => {
      runMotionSweep();
      showSubtitle();
    },
  });

  events.push({
    time: 4780,
    run: () => {
      showComingSoon();
    },
  });

  events.push({
    time: 5580,
    run: () => {
      svg.classList.remove('settled');
      requestAnimationFrame(() => svg.classList.add('settled'));
    },
  });

  events.push({
    time: 7000,
    run: () => {
      spawnEcho(.20);
    },
  });

  events.push({
    time: 7500,
    run: () => {
      subtitle.classList.remove('visible');
      subtitle.classList.add('leaving');
      comingSoon.classList.remove('visible');
      comingSoon.classList.add('leaving');
    },
  });

  events.push({
    time: 7740,
    run: () => {
      applyPlan(timelineLayouts[0], { echo: .08 });
    },
  });

  timelineEvents = events.sort((a, b) => a.time - b.time);
}

function advanceTimeline(now) {
  if (!timelineReady) return 0;

  const elapsed = Math.max(0, now - timelineStart);
  const cycle = Math.floor(elapsed / LOOP_DURATION);
  const ms = elapsed - cycle * LOOP_DURATION;

  if (cycle !== timelineCycle) {
    resetTimelineCycle(cycle);
  }

  setScene(sceneForTime(ms));

  while (
    nextTimelineEvent < timelineEvents.length &&
    timelineEvents[nextTimelineEvent].time <= ms
  ) {
    timelineEvents[nextTimelineEvent].run();
    nextTimelineEvent++;
  }

  timelineMs = ms;
  return ms;
}

function updateCameraFromTimeline(ms) {
  let opacity = 1;
  let x = 0;
  let y = 0;
  let rotation = 0;
  let scale = 1;

  if (ms < 500) {
    const p = easeInOutCubic(ms / 500);
    opacity = .18 + p * .28;
    y = 13 - p * 3;
    scale = 1.27 - p * .08;
    rotation = -.34 + p * .08;
  } else if (ms < 1200) {
    const p = easeOutQuint((ms - 500) / 700);
    opacity = .46 + p * .54;
    x = -.32 * (1 - p);
    y = 10 * (1 - p);
    rotation = -.26 * (1 - p);
    scale = 1.19 - p * .19;
  } else if (ms < 5600) {
    opacity = 1;
    const breathe = Math.sin((ms - 1200) / 900) * .0018;
    scale = 1 + breathe;
    y = Math.sin((ms - 1200) / 1150) * .18;
  } else if (ms < 7000) {
    opacity = 1;
    const breathe = Math.sin((ms - 5600) / 820) * .0025;
    scale = 1 + breathe;
    y = Math.sin((ms - 5600) / 1020) * .22;
  } else if (ms < 7500) {
    const p = easeInOutCubic((ms - 7000) / 500);
    opacity = 1 - p * .12;
    y = -p * 1.1;
    scale = 1 - p * .11;
    rotation = p * .06;
  } else {
    const p = easeInOutCubic((ms - 7500) / 500);
    opacity = .88 * (1 - p);
    y = -1.1 - p * 3.5;
    scale = .89 - p * .08;
    rotation = .06 - p * .10;
  }

  cameraWrap.style.opacity = opacity.toFixed(3);
  cameraWrap.style.transform =
    `translate3d(${x.toFixed(3)}vw,${y.toFixed(3)}vh,0) rotate(${rotation.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
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

  const masterMs = advanceTimeline(now);
  updateCameraFromTimeline(masterMs);

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

    const stableLayout = layout(TITLE, { wght: 780 });
    const asc = extents?.ascender ?? upem * 0.8;
    const desc = extents?.descender ?? -upem * 0.2;
    const padX = upem * 0.42;
    const padY = upem * 0.22;
    const contentWidth = Math.max(stableLayout.width, upem * 1.25);
    stageViewBox = `${-padX} ${-asc - padY} ${contentWidth + padX * 2} ${asc - desc + padY * 2}`;
    svg.setAttribute('viewBox', stageViewBox);

    requestAnimationFrame(frame);
    await sleep(180);

    buildTimeline();

    if (reduceMotion) {
      applyPlan(timelineLayouts[timelineLayouts.length - 1]);
      subtitle.classList.add('visible');
      comingSoon.classList.add('visible');
      setPhase('scene-8');
      return;
    }

    timelineStart = performance.now();
    timelineReady = true;
    resetTimelineCycle(0);
  } catch (error) {
    console.error(error);
    status.textContent = `Could not start HarfBuzz: ${error.message}`;
    status.classList.add('error');
  }
}

init();
