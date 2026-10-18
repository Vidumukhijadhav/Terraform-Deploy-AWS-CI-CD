// 3D layer for Taskflow (Three.js): floating background shapes, a 3D Taski mascot in every
// .mascot-slot, 3D confetti, and hover tilt on cards. If WebGL is unavailable nothing here
// runs and the 2D SVG mascot and emoji confetti from app.js stay in place.
import * as THREE from "/vendor/three/three.module.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PALETTE = [0x8b7bff, 0xff8cc6, 0x5ee7df, 0xffd166, 0xa66cff, 0x6c5ce7, 0x7ee8a2];
const isDark = () => document.documentElement.dataset.theme === "dark";
const rand = (min, max) => min + Math.random() * (max - min);
const lerp = (a, b, t) => a + (b - a) * t;

const pointer = { x: 0, y: 0, clientX: innerWidth / 2, clientY: innerHeight / 2 };
window.addEventListener("pointermove", (e) => {
  pointer.clientX = e.clientX;
  pointer.clientY = e.clientY;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = (e.clientY / innerHeight) * 2 - 1;
});

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

// ---------- shared geometry ----------
function starShape(outer, inner, points = 5) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return shape;
}

function heartShape() {
  const s = new THREE.Shape();
  s.moveTo(5, 5);
  s.bezierCurveTo(5, 5, 4, 0, 0, 0);
  s.bezierCurveTo(-6, 0, -6, 7, -6, 7);
  s.bezierCurveTo(-6, 11, -3, 15.4, 5, 19);
  s.bezierCurveTo(12, 15.4, 16, 11, 16, 7);
  s.bezierCurveTo(16, 7, 16, 0, 10, 0);
  s.bezierCurveTo(7, 0, 5, 5, 5, 5);
  return s;
}

function extrude(shape, depth, bevel, scale = 1) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 18,
  });
  geo.scale(scale, scale, scale);
  geo.center();
  return geo;
}

const starGeo = extrude(starShape(1, 0.45), 0.35, 0.12);
const heartGeo = extrude(heartShape(), 4, 1.5, 0.065);
heartGeo.rotateZ(Math.PI);

function addLights(scene, { hemi = 1.6, key = 2.4, rim = true } = {}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8b7bff, hemi));
  const dir = new THREE.DirectionalLight(0xffffff, key);
  dir.position.set(4, 7, 9);
  scene.add(dir);
  if (rim) {
    const pink = new THREE.DirectionalLight(0xff8cc6, 1.4);
    pink.position.set(-6, -2, -4);
    scene.add(pink);
    const cyan = new THREE.DirectionalLight(0x5ee7df, 1.0);
    cyan.position.set(6, -3, 2);
    scene.add(cyan);
  }
}

function glossy(color, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, ...extra,
  });
}

// ---------- background: floating glossy shapes ----------
function createBackground() {
  const canvas = document.createElement("canvas");
  canvas.className = "scene-bg";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
  camera.position.z = 16;
  addLights(scene);

  const world = new THREE.Group();
  scene.add(world);

  const geometries = [
    [new THREE.TorusKnotGeometry(0.75, 0.26, 180, 24), false],
    [new THREE.TorusGeometry(0.85, 0.34, 32, 96), false],
    [new THREE.IcosahedronGeometry(1, 0), true],
    [new THREE.OctahedronGeometry(0.95, 0), true],
    [new THREE.DodecahedronGeometry(0.9, 0), true],
    [new THREE.SphereGeometry(0.75, 48, 32), false],
    [new THREE.CapsuleGeometry(0.42, 0.9, 8, 24), false],
    [starGeo, false],
    [heartGeo, false],
  ];

  const shapes = [];
  const COUNT = innerWidth < 600 ? 11 : 17;
  for (let i = 0; i < COUNT; i++) {
    const [geo, faceted] = geometries[i % geometries.length];
    const mesh = new THREE.Mesh(geo, glossy(PALETTE[i % PALETTE.length], { flatShading: faceted }));
    const depth = rand(-9, 2);
    mesh.userData = {
      // Spread in normalized screen space so shapes cover the viewport at any aspect ratio.
      u: ((i + 0.5) / COUNT - 0.5) * 1.1 + rand(-0.04, 0.04),
      v: rand(-0.55, 0.55),
      depth,
      amp: rand(0.25, 0.7),
      speed: rand(0.3, 0.8),
      phase: rand(0, Math.PI * 2),
      spin: new THREE.Vector3(rand(-0.4, 0.4), rand(-0.5, 0.5), rand(-0.3, 0.3)),
      scale: rand(0.55, 1.15),
    };
    mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    mesh.scale.setScalar(mesh.userData.scale);
    shapes.push(mesh);
    world.add(mesh);
  }

  // Twinkling dust
  const DUST = 420;
  const positions = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    positions[i * 3] = rand(-22, 22);
    positions[i * 3 + 1] = rand(-16, 16);
    positions[i * 3 + 2] = rand(-14, 4);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const dustMat = new THREE.PointsMaterial({ size: 0.07, transparent: true, depthWrite: false });
  const dust = new THREE.Points(dustGeo, dustMat);
  world.add(dust);

  function applyTheme() {
    dustMat.color.set(isDark() ? 0xeeeaff : 0x8b7bff);
    dustMat.opacity = isDark() ? 0.85 : 0.45;
    for (const s of shapes) s.material.emissiveIntensity = isDark() ? 0.18 : 0;
    for (const s of shapes) s.material.emissive.copy(s.material.color);
  }

  function layout() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    for (const s of shapes) {
      const d = camera.position.z - s.userData.depth;
      const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d;
      s.userData.baseX = s.userData.u * h * camera.aspect;
      s.userData.baseY = s.userData.v * h;
      s.position.set(s.userData.baseX, s.userData.baseY, s.userData.depth);
    }
  }

  let energy = 0;       // 0..1 from task progress: everything spins a bit faster as you get things done
  let targetEnergy = 0;
  let spike = 0;        // short burst on celebrations
  let last = performance.now();

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = now / 1000;
    energy = lerp(energy, targetEnergy, 0.03);
    spike = Math.max(0, spike - dt * 0.8);
    const boost = 1 + energy * 1.5 + spike * 6;

    for (const s of shapes) {
      const u = s.userData;
      s.position.y = u.baseY + Math.sin(t * u.speed + u.phase) * u.amp;
      s.position.x = u.baseX + Math.cos(t * u.speed * 0.7 + u.phase) * u.amp * 0.4;
      s.rotation.x += u.spin.x * dt * boost;
      s.rotation.y += u.spin.y * dt * boost;
      s.rotation.z += u.spin.z * dt * boost;
      s.scale.setScalar(u.scale * (1 + spike * 0.25 * Math.sin(t * 14 + u.phase)));
    }
    dust.rotation.y = t * 0.015;
    dustMat.size = 0.07 + Math.sin(t * 2) * 0.012;

    // Parallax: camera drifts with the pointer, shapes drift up as you scroll.
    camera.position.x = lerp(camera.position.x, pointer.x * 1.4, 0.04);
    camera.position.y = lerp(camera.position.y, -pointer.y * 0.9, 0.04);
    camera.lookAt(0, 0, 0);
    world.position.y = lerp(world.position.y, scrollY * 0.006, 0.08);

    renderer.render(scene, camera);
  }

  layout();
  applyTheme();
  window.addEventListener("resize", () => { layout(); if (reduceMotion) frame(performance.now()); });
  new MutationObserver(() => { applyTheme(); if (reduceMotion) frame(performance.now()); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  return {
    frame,
    setProgress: (pct) => { targetEnergy = pct / 100; },
    celebrate: () => { spike = 1; },
  };
}

// ---------- Taski, the 3D mascot ----------
let shadowTexture;
function getShadowTexture() {
  if (shadowTexture) return shadowTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(40,30,90,0.45)");
  grad.addColorStop(1, "rgba(40,30,90,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  shadowTexture = new THREE.CanvasTexture(c);
  return shadowTexture;
}

function buildMascot() {
  const bodyMat = glossy(0x8b7bff, { roughness: 0.38, clearcoat: 0.7, sheen: 0.6, sheenColor: new THREE.Color(0xc9c0ff) });
  const bellyMat = glossy(0xd4ccff, { roughness: 0.45, clearcoat: 0.4 });
  const limbMat = glossy(0x7a69f0, { roughness: 0.4 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1d1b2e, roughness: 0.25 });
  const cheekMat = new THREE.MeshStandardMaterial({ color: 0xff8cc6, roughness: 0.6, transparent: true, opacity: 0.85 });
  const starMat = new THREE.MeshStandardMaterial({
    color: 0xffd166, emissive: 0xffb703, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.25,
  });

  const root = new THREE.Group();   // moves for jumps / shakes
  const figure = new THREE.Group(); // turns toward the pointer
  root.add(figure);

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), bodyMat);
  body.scale.set(1, 1.08, 0.92);
  body.position.y = 1.25;
  figure.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.62, 48, 32), bellyMat);
  belly.scale.set(1, 0.72, 0.35);
  belly.position.set(0, 0.92, 0.78);
  figure.add(belly);

  const checkPath = new THREE.CurvePath();
  checkPath.add(new THREE.LineCurve3(new THREE.Vector3(-0.2, 0.93, 0.99), new THREE.Vector3(-0.05, 0.79, 1.0)));
  checkPath.add(new THREE.LineCurve3(new THREE.Vector3(-0.05, 0.79, 1.0), new THREE.Vector3(0.24, 1.07, 0.98)));
  figure.add(new THREE.Mesh(new THREE.TubeGeometry(checkPath, 32, 0.045, 10), whiteMat));

  const eyes = [];
  const pupils = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.33, 1.5, 0.8);
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 24), whiteMat);
    white.scale.set(1, 1.15, 0.6);
    const pupil = new THREE.Group();
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), pupilMat);
    iris.scale.z = 0.5;
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), whiteMat);
    glint.position.set(0.04, 0.05, 0.05);
    pupil.add(iris, glint);
    pupil.position.set(side * 0.02, -0.03, 0.11);
    eye.add(white, pupil);
    figure.add(eye);
    eyes.push(eye);
    pupils.push(pupil);

    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12), cheekMat);
    cheek.scale.set(1.3, 0.75, 0.3);
    cheek.position.set(side * 0.58, 1.24, 0.72);
    figure.add(cheek);
  }

  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 12, 32, Math.PI), pupilMat);
  mouth.position.set(0, 1.28, 0.9);
  figure.add(mouth);

  const antennaCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 2.25, 0), new THREE.Vector3(-0.06, 2.62, 0), new THREE.Vector3(0.16, 2.86, 0)
  );
  figure.add(new THREE.Mesh(new THREE.TubeGeometry(antennaCurve, 24, 0.035, 8), limbMat));
  const star = new THREE.Mesh(starGeo, starMat);
  star.scale.setScalar(0.2);
  star.position.set(0.16, 2.95, 0);
  figure.add(star);

  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.9, 1.25, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.42, 6, 16), limbMat);
    arm.position.y = 0.3;
    pivot.add(arm);
    figure.add(pivot);
    arms.push(pivot);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.25, 6, 16), limbMat);
    leg.position.set(side * 0.32, 0.27, 0);
    figure.add(leg);
  }

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshBasicMaterial({ map: getShadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;

  return { root, figure, eyes, pupils, mouth, star, arms, shadow };
}

function createMascot(slot) {
  const canvas = document.createElement("canvas");
  canvas.className = "mascot-3d";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Taski the mascot");
  slot.appendChild(canvas);
  slot.classList.add("is-3d");

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 120 / 130, 0.1, 50);
  camera.position.set(0, 1.65, 8);
  camera.lookAt(0, 1.6, 0);
  addLights(scene, { hemi: 1.8, key: 2.6 });

  const m = buildMascot();
  scene.add(m.root, m.shadow);

  let mood = slot.dataset.mood || "wave";
  let moodStart = performance.now() / 1000;
  new MutationObserver(() => {
    mood = slot.dataset.mood || "wave";
    moodStart = performance.now() / 1000;
  }).observe(slot, { attributes: true, attributeFilter: ["data-mood"] });

  new ResizeObserver(() => {
    const w = slot.clientWidth;
    if (w) renderer.setSize(w, Math.round((w * 130) / 120), false);
  }).observe(slot);

  let blinkAt = 2;
  function frame(now) {
    if (slot.offsetParent === null || !canvas.width) return; // hidden screen: skip rendering
    const t = now / 1000;
    const since = t - moodStart;
    const { root, figure, eyes, pupils, mouth, star, arms, shadow } = m;

    // Look toward the pointer
    const rect = slot.getBoundingClientRect();
    const dx = THREE.MathUtils.clamp(((pointer.clientX - (rect.left + rect.width / 2)) / innerWidth) * 2, -1, 1);
    const dy = THREE.MathUtils.clamp(((pointer.clientY - (rect.top + rect.height / 2)) / innerHeight) * 2, -1, 1);
    figure.rotation.y = lerp(figure.rotation.y, dx * 0.55, 0.08);
    figure.rotation.x = lerp(figure.rotation.x, dy * 0.18, 0.08);
    for (const [i, p] of pupils.entries()) {
      p.position.x = lerp(p.position.x, (i ? 1 : -1) * 0.02 + dx * 0.05, 0.15);
      p.position.y = lerp(p.position.y, -0.03 - dy * 0.04, 0.15);
    }

    // Blink every few seconds
    const blinking = t > blinkAt && t < blinkAt + 0.14;
    if (t > blinkAt + 0.14) blinkAt = t + rand(2.5, 5);
    for (const e of eyes) e.scale.y = blinking ? 0.12 : 1;

    let y = Math.sin(t * 2.4) * 0.06;
    let x = 0;
    let squash = 1;
    let spin = 0;
    let left = 2.55 + Math.sin(t * 2) * 0.08;
    let right = -2.55 - Math.sin(t * 2) * 0.08;
    mouth.rotation.z = Math.PI; // smile
    mouth.position.y = 1.28;
    mouth.scale.set(1, 1, 1);
    star.rotation.y = t * 1.5;
    star.rotation.z = Math.sin(t * 2) * 0.2;

    if (mood === "wave") {
      right = -0.9 + Math.sin(t * 6) * 0.45;
    } else if (mood === "cheer" || mood === "party") {
      const period = mood === "cheer" ? 0.7 : 1.1;
      const jumps = mood === "cheer" ? 2 : Infinity;
      if (since < period * jumps) {
        const f = (since / period) % 1;
        y = Math.sin(f * Math.PI) * 0.65;
        squash = f < 0.12 || f > 0.88 ? 0.9 : 1.04;
        if (mood === "cheer" && since < period) spin = f * Math.PI * 2;
      }
      left = 0.5 + Math.sin(t * 12) * 0.25;
      right = -0.5 - Math.sin(t * 12) * 0.25;
      mouth.scale.set(1.35, 1.6, 1);
      if (mood === "party") star.rotation.z = t * 6;
    } else if (mood === "oops") {
      x = Math.sin(since * 32) * 0.14 * Math.max(0, 1 - since / 0.9);
      left = 2.85;
      right = -2.85;
      mouth.rotation.z = 0; // frown
      mouth.position.y = 1.18;
    }

    root.position.set(x, Math.max(y, 0), 0);
    root.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    root.rotation.y = spin;
    arms[0].rotation.z = lerp(arms[0].rotation.z, left, 0.25);
    arms[1].rotation.z = lerp(arms[1].rotation.z, right, 0.25);
    const lift = Math.max(y, 0);
    shadow.scale.setScalar(1 - lift * 0.45);
    shadow.material.opacity = 1 - lift * 0.6;

    renderer.render(scene, camera);
  }

  return { frame };
}

// ---------- 3D confetti (overlay above the UI) ----------
function createConfetti() {
  const canvas = document.createElement("canvas");
  canvas.className = "scene-confetti";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  // Pixel-space camera: world (x, -y) == screen (x, y).
  const camera = new THREE.OrthographicCamera(0, innerWidth, 0, -innerHeight, -500, 500);
  addLights(scene, { hemi: 2, key: 2.5, rim: false });

  const geos = [
    new THREE.BoxGeometry(1, 0.6, 0.12),
    new THREE.TetrahedronGeometry(0.6),
    starGeo,
    heartGeo,
    new THREE.TorusGeometry(0.45, 0.18, 12, 24),
    new THREE.SphereGeometry(0.45, 16, 12),
  ];

  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.right = innerWidth;
    camera.bottom = -innerHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  const pieces = [];
  let running = false;
  let last = 0;

  function spawn(x, y, count, power) {
    for (let i = 0; i < count; i++) {
      const mat = glossy(PALETTE[Math.floor(Math.random() * PALETTE.length)], { transparent: true });
      const mesh = new THREE.Mesh(geos[Math.floor(Math.random() * geos.length)], mat);
      const size = rand(9, 17);
      mesh.scale.setScalar(size);
      mesh.position.set(x, -y, 0);
      mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      const angle = rand(0, Math.PI * 2);
      const speed = rand(220, 520) * power;
      mesh.userData = {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + rand(250, 450) * power,
        spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
        life: 0,
        ttl: rand(1.1, 1.8),
      };
      scene.add(mesh);
      pieces.push(mesh);
    }
    if (!running) {
      running = true;
      last = performance.now();
      requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      const u = p.userData;
      u.life += dt;
      u.vy -= 1100 * dt; // gravity
      u.vx *= 0.985;
      p.position.x += u.vx * dt;
      p.position.y += u.vy * dt;
      p.rotation.x += u.spin.x * dt;
      p.rotation.y += u.spin.y * dt;
      p.rotation.z += u.spin.z * dt;
      p.material.opacity = Math.min(1, (u.ttl - u.life) * 3);
      if (u.life >= u.ttl) {
        scene.remove(p);
        p.material.dispose();
        pieces.splice(i, 1);
      }
    }
    renderer.render(scene, camera);
    if (pieces.length) requestAnimationFrame(tick);
    else running = false;
  }

  return {
    burst: (x, y) => spawn(x, y, 28, 1),
    celebrate: () => {
      for (let i = 0; i < 5; i++) {
        setTimeout(() => spawn(rand(0.15, 0.85) * innerWidth, rand(0.2, 0.5) * innerHeight, 26, 1.2), i * 180);
      }
    },
  };
}

// ---------- 3D hover tilt on cards ----------
function enableTilt() {
  const TILT = { ".todo": 7, ".stat": 10, ".quote-card": 4, ".auth-card": 3 };
  const selector = Object.keys(TILT).join(",");
  let current = null;
  const reset = (el) => { if (el) el.style.transform = ""; };

  document.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const el = e.target.closest(selector);
    if (el !== current) { reset(current); current = el; }
    if (!el || el.isContentEditable || el.querySelector("[contenteditable=true]")) return;
    const max = TILT[Object.keys(TILT).find((s) => el.matches(s))];
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    const lift = el.matches(".todo") ? " translateY(-2px)" : "";
    el.style.transform = `perspective(900px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg)${lift}`;
  });
  document.documentElement.addEventListener("pointerleave", () => { reset(current); current = null; });
}

// ---------- boot ----------
function main() {
  if (!webglAvailable()) return;
  document.body.classList.add("has-3d");

  const background = createBackground();
  const mascots = [...document.querySelectorAll(".mascot-slot")].map(createMascot);
  const confetti = reduceMotion ? null : createConfetti();

  window.taskflow3d = {
    burst: (x, y) => { confetti?.burst(x, y); background.celebrate(); },
    celebrate: () => { confetti?.celebrate(); background.celebrate(); },
    setProgress: (pct) => background.setProgress(pct),
  };

  if (reduceMotion) {
    // One still frame, re-rendered when a mascot's screen becomes visible.
    const still = () => { const now = performance.now(); background.frame(now); mascots.forEach((m) => m.frame(now)); };
    requestAnimationFrame(still);
    new MutationObserver(() => requestAnimationFrame(still))
      .observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    return;
  }

  enableTilt();
  const loop = (now) => {
    background.frame(now);
    for (const m of mascots) m.frame(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main();
