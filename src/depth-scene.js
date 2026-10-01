import * as THREE from 'three';

// HarfBuzz still owns every contour. A shared mask brings those live outlines
// into a shallow volume without rebuilding triangulated geometry each frame.
export function createDepthScene(host, viewBox) {
  const [minX, minY, width, height] = viewBox.split(' ').map(Number);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.domElement.className = 'depth-stage';
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
  const volume = new THREE.Group();
  scene.add(volume);

  const mask = document.createElement('canvas');
  mask.width = innerWidth < 760 ? 1024 : 2048;
  mask.height = Math.round(mask.width * height / width);
  const context = mask.getContext('2d');
  const texture = new THREE.CanvasTexture(mask);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const geometry = new THREE.PlaneGeometry(1, 1, 72, 24);
  const materials = [];
  const vertexShader = `
    varying vec2 vUv;
    uniform float uTime;
    uniform float uWave;
    void main() {
      vUv = uv;
      vec3 p = position;
      p.z += sin(uv.x * 8.0 - uTime * 3.8) * sin(uv.y * 3.14159) * uWave;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `;
  const fragmentShader = `
    varying vec2 vUv;
    uniform sampler2D uMask;
    uniform vec3 uInk;
    uniform float uOpacity;
    void main() {
      float alpha = texture2D(uMask, vUv).a * uOpacity;
      if (alpha < 0.003) discard;
      gl_FragColor = vec4(uInk, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  // Back-to-front slices give the evolving curves a restrained ink edge.
  for (let i = 7; i >= 0; i--) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMask: { value: texture },
        uTime: { value: 0 },
        uWave: { value: 0 },
        uInk: { value: new THREE.Color(i === 0 ? '#11110f' : '#696963') },
        uOpacity: { value: i === 0 ? 1 : .32 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -i * 1.35;
    mesh.renderOrder = 8 - i;
    volume.add(mesh);
    materials.push(material);
  }

  let active = true;
  let disposed = false;
  let impulse = 0;
  let velocity = 0;
  let tiltX = 0;
  let tiltY = 0;

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = h / (2 * Math.tan(THREE.MathUtils.degToRad(17.5)));
    camera.updateProjectionMatrix();
    const fit = Math.min(w / width, h / height);
    for (const mesh of volume.children) mesh.scale.set(width * fit, height * fit, 1);
  }

  function loseContext(event) {
    event.preventDefault();
    active = false;
    host.classList.remove('has-depth');
  }

  function restoreContext() {
    if (disposed) return;
    active = true;
    texture.needsUpdate = true;
    resize();
  }

  renderer.domElement.addEventListener('webglcontextlost', loseContext);
  renderer.domElement.addEventListener('webglcontextrestored', restoreContext);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  host.appendChild(renderer.domElement);
  resize();

  return {
    updatePaths(paths) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, mask.width, mask.height);
      const sx = mask.width / width;
      const sy = mask.height / height;
      context.setTransform(sx, 0, 0, -sy, -minX * sx, -minY * sy);
      context.fillStyle = '#11110f';
      for (const path of paths) {
        context.globalAlpha = THREE.MathUtils.clamp(path.opacity, 0, 1);
        context.fill(new Path2D(path.d), 'nonzero');
      }
      context.globalAlpha = 1;
      texture.needsUpdate = true;
    },
    hit(progress) {
      velocity += 45 * (1 - progress * .45);
    },
    tick(time, dt, nx, ny, energy, ms) {
      if (!active || disposed) return;
      // Damped recoil is triggered by the same plans as the contour springs.
      const steps = Math.max(1, Math.ceil(dt * 120));
      for (let i = 0; i < steps; i++) {
        velocity += (-150 * impulse - 22 * velocity) * dt / steps;
        impulse += velocity * dt / steps;
      }
      const ease = 1 - Math.exp(-dt * 5);
      const assembly = 1 - THREE.MathUtils.smoothstep(ms, 3200, 4400);
      const release = THREE.MathUtils.smoothstep(ms, 7000, 8000);
      tiltX += (-ny * .16 - tiltX) * ease;
      tiltY += (nx * .22 - tiltY) * ease;
      volume.rotation.set(tiltX + assembly * .035, tiltY - release * .12, 0);
      volume.position.z = impulse * 1.8;
      for (const material of materials) {
        material.uniforms.uTime.value = time;
        material.uniforms.uWave.value = assembly * 7 + impulse * 6 + energy * 2 + release * 14;
      }
      renderer.render(scene, camera);
      host.classList.add('has-depth');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', loseContext);
      renderer.domElement.removeEventListener('webglcontextrestored', restoreContext);
      geometry.dispose();
      materials.forEach((material) => material.dispose());
      texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      host.classList.remove('has-depth');
    },
  };
}
