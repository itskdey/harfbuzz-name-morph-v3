import * as THREE from 'three';

const TAU = Math.PI * 2;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
  const x = clamp01((value - edge0) / Math.max(.0001, edge1 - edge0));
  return x * x * (3 - 2 * x);
}

function hash2(x, y) {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return v - Math.floor(v);
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ||
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true }),
    );
  } catch {
    return false;
  }
}

function detectQuality(reducedMotion) {
  if (reducedMotion || !supportsWebGL()) return 'static';

  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const pixels = innerWidth * innerHeight * Math.min(devicePixelRatio || 1, 2);

  if (cores >= 8 && memory >= 8 && pixels < 5_000_000) return 'high';
  if (cores >= 4 && memory >= 4) return 'medium';
  return 'low';
}

function makeColorTexture(size = 384) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const dx = u - .5;
      const dy = v - .5;
      const radial = Math.exp(-(dx * dx * 6.3 + dy * dy * 5.1));
      const foldA = Math.sin(u * 12.0 + v * 5.7) * .5 + .5;
      const foldB = Math.sin(v * 18.0 - u * 4.3) * .5 + .5;
      const paper = hash2(Math.floor(x / 4), Math.floor(y / 4));
      const warm = radial * .62 + foldA * .08 + foldB * .05;
      const grain = (paper - .5) * .045;

      const r = Math.round(242 + warm * 10 + grain * 255);
      const g = Math.round(240 + warm * 5 + grain * 230);
      const b = Math.round(232 - warm * 15 + grain * 190);

      const i = (y * size + x) * 4;
      image.data[i] = Math.max(0, Math.min(255, r));
      image.data[i + 1] = Math.max(0, Math.min(255, g));
      image.data[i + 2] = Math.max(0, Math.min(255, b));
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeDepthTexture(size = 256) {
  const data = new Uint8Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const dx = u - .5;
      const dy = v - .5;

      const center = Math.exp(-(dx * dx * 8.5 + dy * dy * 6.2));
      const ridge = Math.exp(-Math.pow(dy + Math.sin(u * 7.0) * .075, 2) * 36.0) * .24;
      const corner = Math.exp(-((u - .18) ** 2 + (v - .22) ** 2) * 24.0) * .16;
      const noise =
        Math.sin(u * 16.0 + v * 8.0) * .035 +
        Math.sin(v * 24.0 - u * 5.0) * .025;

      const depth = clamp01(.22 + center * .56 + ridge + corner + noise);
      data[y * size + x] = Math.round(depth * 255);
    }
  }

  const texture = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );

  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const vertexShader = `
uniform sampler2D uDepth;
uniform float uTime;
uniform float uDepthStrength;
uniform float uBreath;
uniform vec2 uPointer;

varying vec2 vUv;
varying float vDepth;
varying float vWave;

void main() {
  vUv = uv;

  float depth = texture2D(uDepth, uv).r;
  float waveA = sin(uv.y * 8.0 + uTime * 0.32) * 0.018;
  float waveB = cos(uv.x * 10.0 - uTime * 0.25) * 0.012;
  float pointerLift = (uv.x - 0.5) * uPointer.x * 0.12
                    - (uv.y - 0.5) * uPointer.y * 0.09;

  vec3 p = position;
  p.z += (depth - 0.43) * uDepthStrength;
  p.z += (waveA + waveB) * uBreath;
  p.z += pointerLift;

  vDepth = depth;
  vWave = waveA + waveB;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = `
uniform sampler2D uMap;
uniform float uTime;
uniform float uOpacity;
uniform float uAccent;
uniform float uLight;
uniform vec2 uPointer;

varying vec2 vUv;
varying float vDepth;
varying float vWave;

float vignette(vec2 uv) {
  vec2 p = uv - 0.5;
  return smoothstep(0.78, 0.18, length(p));
}

void main() {
  vec2 uv = vUv;
  vec4 base = texture2D(uMap, uv);

  vec2 lightPos = vec2(
    0.5 + uPointer.x * 0.12 + sin(uTime * 0.16) * 0.035,
    0.46 - uPointer.y * 0.10 + cos(uTime * 0.13) * 0.025
  );

  float glow = exp(-distance(uv, lightPos) * 4.8) * uLight;
  float contour = smoothstep(.42, .82, vDepth) * .055;
  float accentBand = exp(-abs(uv.y - (.54 + sin(uv.x * 5.0 + uTime * .18) * .035)) * 23.0);

  vec3 ink = vec3(0.066, 0.066, 0.059);
  vec3 orange = vec3(1.0, 0.31, 0.071);

  vec3 color = base.rgb;
  color = mix(color, ink, contour);
  color += glow * vec3(.035, .031, .022);
  color = mix(color, orange, accentBand * uAccent * .035);
  color *= .985 + vWave * .035;

  float alpha = vignette(uv) * uOpacity;
  gl_FragColor = vec4(color, alpha);
}
`;

export class WebGLBackdrop {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.quality = detectQuality(reducedMotion);
    this.enabled = this.quality !== 'static';
    this.pointer = new THREE.Vector2();
    this.pointerTarget = new THREE.Vector2();
    this.lastTime = performance.now();
    this.fpsEMA = 60;
    this.slowFrames = 0;

    if (!this.enabled || !canvas) {
      document.documentElement.dataset.webglQuality = 'static';
      return;
    }

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: this.quality === 'high',
        powerPreference: 'high-performance',
        premultipliedAlpha: true,
      });

      this.renderer.setClearColor(0xf5f4ee, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setPixelRatio(
        Math.min(devicePixelRatio || 1, this.quality === 'high' ? 1.65 : 1.25),
      );

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(32, 1, .1, 20);
      this.camera.position.set(0, 0, 5.25);

      const segments =
        this.quality === 'high'
          ? [160, 100]
          : this.quality === 'medium'
            ? [108, 68]
            : [72, 44];

      this.geometry = new THREE.PlaneGeometry(2, 2, segments[0], segments[1]);
      this.colorTexture = makeColorTexture(this.quality === 'high' ? 512 : 320);
      this.depthTexture = makeDepthTexture(this.quality === 'high' ? 320 : 192);

      this.uniforms = {
        uMap: { value: this.colorTexture },
        uDepth: { value: this.depthTexture },
        uTime: { value: 0 },
        uDepthStrength: { value: .38 },
        uBreath: { value: .45 },
        uPointer: { value: new THREE.Vector2() },
        uOpacity: { value: .72 },
        uAccent: { value: .3 },
        uLight: { value: .6 },
      };

      this.material = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.scene.add(this.mesh);

      this.backGeometry = new THREE.PlaneGeometry(2, 2, 40, 24);
      this.backMaterial = new THREE.MeshBasicMaterial({
        color: 0xf2efe4,
        transparent: true,
        opacity: .24,
        depthWrite: false,
      });
      this.backMesh = new THREE.Mesh(this.backGeometry, this.backMaterial);
      this.backMesh.position.z = -.34;
      this.backMesh.rotation.z = -.035;
      this.scene.add(this.backMesh);

      this.resize = this.resize.bind(this);
      addEventListener('resize', this.resize, { passive: true });
      this.resize();
      document.documentElement.dataset.webglQuality = this.quality;
    } catch (error) {
      console.warn('WebGL backdrop disabled:', error);
      this.enabled = false;
      document.documentElement.dataset.webglQuality = 'static';
    }
  }

  resize() {
    if (!this.enabled) return;

    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);

    const distance = this.camera.position.z;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const visibleHeight = 2 * Math.tan(vFov / 2) * distance;
    const visibleWidth = visibleHeight * this.camera.aspect;

    const cover = 1.15;
    this.mesh.scale.set(visibleWidth * .58 * cover, visibleHeight * .58 * cover, 1);
    this.backMesh.scale.set(visibleWidth * .62, visibleHeight * .62, 1);
  }

  setPointer(nx, ny) {
    if (!this.enabled) return;
    this.pointerTarget.set(nx, ny);
  }

  update(now, timelineMs) {
    if (!this.enabled) return;

    const dt = Math.min(.05, Math.max(.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    const fps = 1 / dt;
    this.fpsEMA += (fps - this.fpsEMA) * .035;

    if (this.fpsEMA < 42) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 2);

    if (this.slowFrames > 120 && this.quality === 'high') {
      this.quality = 'medium';
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.2));
      document.documentElement.dataset.webglQuality = 'medium';
      this.slowFrames = 0;
    }

    const pointerEase = 1 - Math.exp(-dt * 3.6);
    this.pointer.lerp(this.pointerTarget, pointerEase);

    const p = timelineMs / 8000;
    const intro = smoothstep(0, .15, p);
    const morph = smoothstep(.14, .42, p);
    const reveal = smoothstep(.42, .63, p);
    const exit = smoothstep(.89, 1, p);

    this.uniforms.uTime.value = now / 1000;
    this.uniforms.uPointer.value.copy(this.pointer);
    this.uniforms.uDepthStrength.value = .22 + intro * .18 + morph * .055 - exit * .16;
    this.uniforms.uBreath.value = .30 + reveal * .36;
    this.uniforms.uOpacity.value = (.42 + intro * .32) * (1 - exit * .84);
    this.uniforms.uAccent.value = .14 + morph * .48 + reveal * .12;
    this.uniforms.uLight.value = .35 + reveal * .42;

    const cameraEase = .82 + intro * .18;
    this.camera.position.x = this.pointer.x * .085 * cameraEase;
    this.camera.position.y = -this.pointer.y * .058 * cameraEase;
    this.camera.position.z = 5.34 - intro * .14 + exit * .24;

    this.mesh.rotation.x = -this.pointer.y * .018;
    this.mesh.rotation.y = this.pointer.x * .026;
    this.mesh.rotation.z = Math.sin(now / 6800) * .006;

    const drift = Math.sin(now / 3100) * .015;
    this.mesh.position.y = drift - exit * .08;
    this.backMesh.position.x = -this.pointer.x * .045;
    this.backMesh.position.y = this.pointer.y * .03;

    this.renderer.render(this.scene, this.camera);
  }

  renderStatic() {
    if (!this.enabled) return;
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    if (!this.enabled) return;
    removeEventListener('resize', this.resize);
    this.geometry?.dispose();
    this.backGeometry?.dispose();
    this.material?.dispose();
    this.backMaterial?.dispose();
    this.colorTexture?.dispose();
    this.depthTexture?.dispose();
    this.renderer?.dispose();
  }
}
