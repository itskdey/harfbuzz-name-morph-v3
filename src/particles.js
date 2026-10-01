const TAU = Math.PI * 2;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeInOutCubic(t) {
  t = clamp01(t);
  return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function hash(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export class ParticleField {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d', { alpha: true, desynchronized: true }) ?? null;
    this.reducedMotion = reducedMotion;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.ambient = [];
    this.bursts = [];
    this.lastNow = performance.now();
    this.pointerX = 0;
    this.pointerY = 0;

    this.resize = this.resize.bind(this);
    addEventListener('resize', this.resize, { passive: true });
    this.resize();
  }

  resize() {
    if (!this.canvas || !this.ctx) return;

    this.width = Math.max(1, innerWidth);
    this.height = Math.max(1, innerHeight);
    this.dpr = Math.min(devicePixelRatio || 1, 1.75);

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.buildAmbient();
  }

  buildAmbient() {
    const count = this.reducedMotion
      ? 0
      : Math.round(Math.min(190, Math.max(90, (this.width * this.height) / 7200)));

    this.ambient.length = 0;

    for (let i = 0; i < count; i++) {
      const a = hash(i + 1);
      const b = hash(i + 101);
      const c = hash(i + 211);
      const d = hash(i + 307);
      const e = hash(i + 401);

      this.ambient.push({
        angle: a * TAU,
        radius: .13 + b * .56,
        speed: (.025 + c * .065) * (d > .5 ? 1 : -1),
        size: .65 + e * 1.45,
        alpha: .14 + hash(i + 503) * .42,
        eccentricity: .42 + hash(i + 601) * .52,
        tilt: (-.52 + hash(i + 701) * 1.04),
        phase: hash(i + 809) * TAU,
        accent: hash(i + 907) > .83,
        depth: .35 + hash(i + 1009) * .65,
      });
    }
  }

  setPointer(nx, ny) {
    this.pointerX = nx;
    this.pointerY = ny;
  }

  burst(strength = 1, finalBurst = false) {
    if (this.reducedMotion || !this.ctx) return;

    const count = finalBurst ? 28 : Math.round(5 + strength * 8);
    const cx = this.width * .5;
    const cy = this.height * .5;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + hash(i + this.bursts.length * 17) * .34;
      const speed = (finalBurst ? 82 : 34) + hash(i + 19) * (finalBurst ? 115 : 60);

      this.bursts.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * .62,
        life: 0,
        ttl: finalBurst ? .95 + hash(i + 31) * .45 : .48 + hash(i + 41) * .28,
        size: finalBurst ? 1.2 + hash(i + 53) * 2.1 : .8 + hash(i + 59) * 1.35,
        accent: finalBurst ? i % 3 === 0 : i % 5 === 0,
      });
    }
  }

  update(now, timelineMs = 0) {
    if (!this.ctx) return;

    const dt = Math.min(.033, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w * .5;
    const cy = h * .5;
    const minDim = Math.min(w, h);
    const t = timelineMs / 1000;

    ctx.clearRect(0, 0, w, h);

    if (this.reducedMotion) return;

    let fieldStrength = .34;
    let radialScale = 1;
    let scatter = 0;
    let opacityScale = 1;

    if (timelineMs < 500) {
      const p = easeInOutCubic(timelineMs / 500);
      fieldStrength = .16 + p * .22;
      radialScale = 1.1 - p * .08;
    } else if (timelineMs < 1200) {
      const p = easeInOutCubic((timelineMs - 500) / 700);
      fieldStrength = .38 + p * .26;
      radialScale = 1.02 - p * .12;
    } else if (timelineMs < 3000) {
      const p = easeInOutCubic((timelineMs - 1200) / 1800);
      fieldStrength = .64 + p * .23;
      radialScale = .90 - p * .12;
    } else if (timelineMs < 4800) {
      const p = easeInOutCubic((timelineMs - 3000) / 1800);
      fieldStrength = .87 - p * .10;
      radialScale = .78 + p * .08;
    } else if (timelineMs < 7000) {
      fieldStrength = .72;
      radialScale = .88;
    } else {
      const p = easeInOutCubic((timelineMs - 7000) / 1000);
      fieldStrength = .72 * (1 - p);
      radialScale = .88 + p * .56;
      scatter = p;
      opacityScale = 1 - p * .72;
    }

    const px = this.pointerX * 18;
    const py = this.pointerY * 13;

    ctx.save();
    ctx.translate(px, py);

    for (let i = 0; i < this.ambient.length; i++) {
      const p = this.ambient[i];
      const orbitTime = t * p.speed;
      const angle = p.angle + orbitTime + Math.sin(t * .17 + p.phase) * .11;
      const baseRadius = minDim * p.radius * radialScale;
      const xOrbit = Math.cos(angle) * baseRadius;
      const yOrbit = Math.sin(angle) * baseRadius * p.eccentricity;
      const cosTilt = Math.cos(p.tilt);
      const sinTilt = Math.sin(p.tilt);

      let x = cx + xOrbit * cosTilt - yOrbit * sinTilt;
      let y = cy + xOrbit * sinTilt + yOrbit * cosTilt;

      if (scatter > 0) {
        const outward = 1 + scatter * (1.4 + p.depth);
        x = cx + (x - cx) * outward;
        y = cy + (y - cy) * outward;
      }

      const shimmer = .72 + Math.sin(t * (.9 + p.depth) + p.phase) * .28;
      const alpha = p.alpha * shimmer * fieldStrength * opacityScale;
      if (alpha <= .01) continue;

      const trailAngle = angle - .018 * (p.speed > 0 ? 1 : -1);
      const txOrbit = Math.cos(trailAngle) * baseRadius;
      const tyOrbit = Math.sin(trailAngle) * baseRadius * p.eccentricity;
      const tx = cx + txOrbit * cosTilt - tyOrbit * sinTilt;
      const ty = cy + txOrbit * sinTilt + tyOrbit * cosTilt;

      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.strokeStyle = p.accent
        ? `rgba(255,79,18,${alpha * .42})`
        : `rgba(17,17,15,${alpha * .16})`;
      ctx.lineWidth = Math.max(.35, p.size * .32);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, p.size * (.76 + p.depth * .28), 0, TAU);
      ctx.fillStyle = p.accent
        ? `rgba(255,79,18,${alpha})`
        : `rgba(17,17,15,${alpha * .74})`;
      ctx.fill();
    }

    ctx.restore();

    if (fieldStrength > .18) {
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, minDim * .20);
      glow.addColorStop(0, `rgba(255,79,18,${.034 * fieldStrength})`);
      glow.addColorStop(.38, `rgba(255,79,18,${.013 * fieldStrength})`);
      glow.addColorStop(1, 'rgba(255,79,18,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - minDim * .20, cy - minDim * .20, minDim * .40, minDim * .40);
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const p = this.bursts[i];
      p.life += dt;

      if (p.life >= p.ttl) {
        this.bursts.splice(i, 1);
        continue;
      }

      const life = p.life / p.ttl;
      const drag = Math.pow(.982, dt * 60);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 7 * dt;

      const alpha = Math.sin(Math.min(1, life * 3) * Math.PI * .5) * (1 - life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - life * .42), 0, TAU);
      ctx.fillStyle = p.accent
        ? `rgba(255,79,18,${alpha * .88})`
        : `rgba(17,17,15,${alpha * .58})`;
      ctx.fill();
    }
  }

  destroy() {
    removeEventListener('resize', this.resize);
  }
}
