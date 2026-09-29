/**
 * AeroTwin-DT :: interactive 3D engine twin (Three.js)
 * Procedurally-built AE-115T flat-four aero piston engine with live kinematics
 * (crank, rods, pistons, prop), thermal shading, vibration response, exhaust
 * flow, misfire flashes, cutaway/exploded/thermal modes and click-to-inspect
 * hotspots on every monitored component.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PART_SENSORS, UNITS, sensorLabel, val } from '../lib/constants.js';

const C = {
  alloy: 0xa9b1ba, dark: 0x3a414a, head: 0xb6bec7, steel: 0xccd3da,
  accent: 0x00d3a7, warn: 0xffb020, crit: 0xff4d5e, hot: 0xff5a1f,
};

function unitForKey(k) {
  const base = k.replace(/[0-9]/g, '').replace('cylCHT', 'cht').replace('cylEGT', 'egt');
  return UNITS[base] || '';
}

export class EngineTwin3D {
  constructor(container, overlay, onSelect) {
    this.el = container; this.overlay = overlay; this.onSelect = onSelect;
    this.parts = new Map();          // partId -> { mesh, label, mat, base }
    this.mode = { cutaway: false, exploded: false, thermal: false, labels: true };
    this.crankAngle = 0; this.propAngle = 0; this.faultParts = new Map();
    this.running = true;
    this.burst = null; // active "inspect burst" animation state, see select()
    this.clock = new THREE.Clock();
    this.tm = null;
    this._disposed = false;
    this._init();
    this._build();
    this._bindEvents();
    this._animate();
  }

  /* ------------------------------------------------------------ cleanup
     (added for the React port — the original static page never unmounted
     the twin, but a component can, e.g. on route change / hot reload) */
  dispose() {
    this._disposed = true;
    if (this._ro) this._ro.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    if (this.labelEls) this.labelEls.forEach((l) => l.el.remove());
    this.calloutEl?.remove();
  }

  /* ------------------------------------------------------------ scene */
  _init() {
    const w = this.el.clientWidth, h = this.el.clientHeight || 480;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0d12);
    this.scene.fog = new THREE.Fog(0x0a0d12, 14, 34);

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
    this.camera.position.set(4.9, 2.7, 5.7);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.el.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 3.0; this.controls.maxDistance = 16;
    this.controls.target.set(0, 0.35, 0);
    this.controls.autoRotateSpeed = 0.6;

    this.scene.add(new THREE.HemisphereLight(0xcfe0f2, 0x11161d, 0.85));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(6, 9, 6); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = 1; key.shadow.camera.far = 30;
    key.shadow.camera.left = -8; key.shadow.camera.right = 8;
    key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fd8ff, 0.45); rim.position.set(-7, 3, -5); this.scene.add(rim);
    const fill = new THREE.PointLight(0x00d3a7, 6, 14); fill.position.set(0.5, 2.2, 3.5); this.scene.add(fill);
    const fill2 = new THREE.DirectionalLight(0xffffff, 0.5); fill2.position.set(2, 1.5, -6); this.scene.add(fill2);

    const grid = new THREE.GridHelper(40, 40, 0x1d2732, 0x141a22);
    grid.position.y = -1.8; this.scene.add(grid);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64),
      new THREE.MeshStandardMaterial({ color: 0x0d1218, roughness: 0.95, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.79; floor.receiveShadow = true;
    this.scene.add(floor);

    this.root = new THREE.Group(); this.scene.add(this.root);
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2(-9, -9);
  }

  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color, metalness: opts.metalness ?? 0.62, roughness: opts.roughness ?? 0.44,
      transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
      emissive: new THREE.Color(0x000000),
    });
  }

  _register(mesh, id, label, group, home) {
    mesh.userData = { partId: id, label };
    mesh.castShadow = true; mesh.receiveShadow = true;
    const list = this.parts.get(id) || { meshes: [], label, home: home || new THREE.Vector3() };
    list.meshes.push(mesh); list.label = label;
    if (home) list.home = home;
    this.parts.set(id, list);
    (group || this.root).add(mesh);
    return mesh;
  }

  /* ------------------------------------------------------------ geometry */
  _build() {
    const R = this.root;

    // ---- crankcase -------------------------------------------------------
    const caseGeo = new THREE.BoxGeometry(1.5, 1.25, 3.0, 2, 2, 4);
    const crankcase = new THREE.Mesh(caseGeo, this._mat(C.alloy, { roughness: 0.5 }));
    crankcase.position.set(0, 0.35, 0);
    this._register(crankcase, 'crankcase', 'Crankcase / rotating assembly', R, new THREE.Vector3(0, 0.35, 0));

    // ---- oil sump --------------------------------------------------------
    const sump = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 2.3),
      this._mat(0x4a5058, { roughness: 0.6 }));
    sump.position.set(0, -0.5, 0);
    this._register(sump, 'sump', 'Oil sump & lubrication circuit', R, sump.position.clone());
    const oilpump = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.34, 20),
      this._mat(0x6b727b));
    oilpump.rotation.z = Math.PI / 2; oilpump.position.set(0.85, -0.35, -1.0);
    this._register(oilpump, 'oilpump', 'Oil pump & pressure regulator', R, oilpump.position.clone());

    // ---- cylinders (flat-four: 2 per bank, banks on +/-X) ----------------
    this.cylinders = [];
    const zPos = [0.95, -0.95];
    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? 1 : -1;
      const z = zPos[i % 2];
      const g = new THREE.Group();
      g.position.set(side * 0.75, 0.35, z);
      g.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      R.add(g);

      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.78, 28, 1, true),
        this._mat(0x6f767f, { roughness: 0.55 }));
      barrel.position.y = 0.42;
      this._register(barrel, `cyl${i}`, `Cylinder ${i + 1}`, g);

      // cooling fins
      for (let f = 0; f < 6; f++) {
        const fin = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 26),
          this._mat(0x878f98, { roughness: 0.6 }));
        fin.rotation.x = Math.PI / 2; fin.position.y = 0.18 + f * 0.12;
        this._register(fin, `cyl${i}`, `Cylinder ${i + 1}`, g);
      }

      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.42, 0.34, 28),
        this._mat(C.head, { roughness: 0.42 }));
      head.position.y = 0.98;
      this._register(head, 'head', 'Cylinder heads & CHT probes', g);

      const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.26, 12),
        this._mat(0xd8dde3, { metalness: 0.95, roughness: 0.2 }));
      plug.position.set(0.18, 1.2, 0.1);
      this._register(plug, 'ignition', 'Ignition system (plugs / coils)', g);

      const inj = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12),
        this._mat(0x2f6df0, { metalness: 0.6, roughness: 0.35 }));
      inj.position.set(-0.2, 1.18, -0.06); inj.rotation.z = 0.35;
      this._register(inj, 'injector', `Fuel injector ${i + 1}`, g);

      // piston + rod (visible in cutaway)
      const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.3, 24),
        this._mat(0xc9cfd6, { metalness: 0.95, roughness: 0.25 }));
      piston.position.y = 0.4;
      this._register(piston, `cyl${i}`, `Cylinder ${i + 1} piston`, g);
      const rod = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.16),
        this._mat(0xa8b0b8, { metalness: 0.95, roughness: 0.3 }));
      rod.position.y = 0.05;
      this._register(rod, 'crankcase', 'Connecting rod', g);

      this.cylinders.push({ group: g, barrel, head, piston, rod, plug, inj, side, index: i, fins: [] });
    }

    // ---- crankshaft ------------------------------------------------------
    this.crank = new THREE.Group(); this.crank.position.set(0, 0.35, 0); R.add(this.crank);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.1, 20),
      this._mat(0xdfe4e9, { metalness: 1, roughness: 0.18 }));
    shaft.rotation.x = Math.PI / 2;
    this._register(shaft, 'crankcase', 'Crankshaft', this.crank);
    for (let i = 0; i < 4; i++) {
      const web = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.14),
        this._mat(0xbcc3ca, { metalness: 1, roughness: 0.25 }));
      web.position.set(0, 0, [1.05, 0.85, -0.85, -1.05][i]);
      web.rotation.z = i * Math.PI / 2;
      this._register(web, 'crankcase', 'Crank web', this.crank);
    }

    // ---- propeller / gearbox --------------------------------------------
    const gearbox = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.5, 24),
      this._mat(0x767d86, { roughness: 0.5 }));
    gearbox.rotation.x = Math.PI / 2; gearbox.position.set(0, 0.62, 1.75);
    this._register(gearbox, 'gearbox', 'Reduction gearbox (2.43:1)', R, gearbox.position.clone());

    this.prop = new THREE.Group(); this.prop.position.set(0, 0.62, 2.12); R.add(this.prop);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 16), this._mat(0x30363d, { roughness: 0.4 }));
    this._register(hub, 'prop', 'Propeller & hub', this.prop);
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.75, 0.24),
        this._mat(0x1e242c, { roughness: 0.45, metalness: 0.4 }));
      blade.geometry.translate(0, 0.9, 0);
      blade.rotation.z = (b * 2 * Math.PI) / 3;
      blade.rotation.y = 0.34;
      this._register(blade, 'prop', 'Propeller blade', this.prop);
    }

    // ---- turbocharger + exhaust -----------------------------------------
    const turbine = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.19, 14, 28),
      this._mat(0x555c65, { roughness: 0.55 }));
    turbine.position.set(0, 0.15, -1.95); turbine.rotation.y = Math.PI / 2;
    this._register(turbine, 'turbo', 'Turbocharger / wastegate', R, turbine.position.clone());
    const compressor = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.26, 22),
      this._mat(0x9aa1a9, { roughness: 0.35 }));
    compressor.position.set(0, 0.15, -2.28); compressor.rotation.x = Math.PI / 2;
    this._register(compressor, 'turbo', 'Compressor housing', R, compressor.position.clone());
    this.turboSpin = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 18),
      this._mat(C.accent, { metalness: 0.4, roughness: 0.3 }));
    this.turboSpin.position.copy(compressor.position); this.turboSpin.rotation.x = Math.PI / 2;
    this._register(this.turboSpin, 'turbo', 'Compressor wheel', R, compressor.position.clone());

    // exhaust headers -> collector
    this.headers = [];
    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? 1 : -1, z = zPos[i % 2];
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 1.32, 0.72, z),
        new THREE.Vector3(side * 1.55, 0.35, z * 0.6),
        new THREE.Vector3(side * 0.95, 0.05, -1.35),
        new THREE.Vector3(0, 0.12, -1.78),
      ]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.085, 12, false),
        this._mat(0x7b8189, { metalness: 0.9, roughness: 0.45 }));
      this._register(tube, 'exhaust', `Exhaust header ${i + 1}`, R);
      this.headers.push({ curve, tube });
    }
    const tailpipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.9, 18),
      this._mat(0x6c737b, { metalness: 0.9, roughness: 0.5 }));
    tailpipe.rotation.x = Math.PI / 2; tailpipe.position.set(0, 0.15, -2.75);
    this._register(tailpipe, 'exhaust', 'Exhaust / EGT probe', R, tailpipe.position.clone());

    // ---- intake plenum + fuel rail --------------------------------------
    const plenum = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.34, 1.9),
      this._mat(0x3d444c, { roughness: 0.5 }));
    plenum.position.set(0, 1.28, -0.1);
    this._register(plenum, 'intake', 'Intake plenum & MAP sensor', R, plenum.position.clone());
    for (const side of [1, -1]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 14),
        this._mat(0x2f6df0, { metalness: 0.5, roughness: 0.35 }));
      rail.rotation.x = Math.PI / 2; rail.position.set(side * 1.15, 1.2, 0);
      this._register(rail, 'fuelrail', 'Fuel rail & injection system', R, rail.position.clone());
    }

    // ---- alternator + ECU ------------------------------------------------
    const alt = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.42, 22),
      this._mat(0x5b626a, { roughness: 0.5 }));
    alt.rotation.z = Math.PI / 2; alt.position.set(0.0, -0.15, 1.55);
    this._register(alt, 'alternator', 'Alternator & battery bus', R, alt.position.clone());
    const ecu = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.78),
      this._mat(0x1f6b5a, { metalness: 0.5, roughness: 0.5 }));
    ecu.position.set(0, 1.62, -1.15);
    this._register(ecu, 'ecu', 'ECU / FADEC & CAN bus node', R, ecu.position.clone());
    const radiator = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.85, 0.16),
      this._mat(0x39404a, { roughness: 0.7 }));
    radiator.position.set(0, 0.55, 2.55);
    this._register(radiator, 'radiator', 'Coolant radiator / cooling ducts', R, radiator.position.clone());

    // ---- exhaust particle flow ------------------------------------------
    const N = 220;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.flow = { n: N, u: new Float32Array(N), lane: new Uint8Array(N) };
    for (let i = 0; i < N; i++) { this.flow.u[i] = Math.random(); this.flow.lane[i] = i % 4; }
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 0.075, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.particles);

    // ---- misfire flash ---------------------------------------------------
    this.flash = new THREE.PointLight(C.crit, 0, 3.2);
    this.scene.add(this.flash);

    // record home positions for exploded view
    this.parts.forEach((p) => {
      p.meshes.forEach(m => { m.userData.home = m.position.clone(); });
      p.baseColors = p.meshes.map(m => m.material.color.clone());
    });
    this._buildLabels();
  }

  /* ------------------------------------------------------------ labels */
  _buildLabels() {
    this.labelEls = [];
    const anchors = {
      cyl0: [2.5, 1.15, 0.95], turbo: [0, 0.05, -3.4], prop: [0, 2.7, 2.3],
      sump: [0, -1.35, 0.5], ecu: [0, 2.45, -1.2], radiator: [1.7, 1.25, 3.0],
      fuelrail: [-2.5, 1.7, -0.6], alternator: [-1.7, -0.85, 1.8], exhaust: [-2.3, -0.2, -2.1],
    };
    for (const [id, pos] of Object.entries(anchors)) {
      const d = document.createElement('button');
      d.className = 'hotspot';
      d.innerHTML = `<span class="dot"></span><span class="txt">${this.parts.get(id)?.label || id}</span>`;
      d.addEventListener('click', () => this.select(id));
      this.overlay.appendChild(d);
      this.labelEls.push({ id, el: d, v: new THREE.Vector3(...pos) });
    }

    // Live-value callout — pops in right next to whatever component was
    // just touched/clicked, on the same 6s window as the inspect-burst
    // animation, and refreshes its readout every frame while open.
    this.calloutEl = document.createElement('div');
    this.calloutEl.className = 'twin-callout';
    this.calloutEl.style.display = 'none';
    this.overlay.appendChild(this.calloutEl);
  }

  _restartCalloutPop() {
    const el = this.calloutEl; if (!el) return;
    el.style.animation = 'none';
    void el.offsetWidth; // force reflow so the animation replays on re-selection
    el.style.animation = '';
  }

  _renderCallout(partId) {
    const el = this.calloutEl; if (!el) return;
    const part = this.parts.get(partId);
    const mesh = part?.meshes?.[0];
    if (!mesh) { el.style.display = 'none'; return; }
    const world = new THREE.Vector3();
    mesh.getWorldPosition(world);
    const proj = world.clone().project(this.camera);
    if (proj.z >= 1) { el.style.display = 'none'; return; }

    const sensors = (PART_SENSORS[partId] || []).slice(0, 3);
    const rows = sensors.map((k) => {
      const v = val(this.tm, k);
      const shown = v === undefined || v === null || Number.isNaN(v) ? '\u2014' : v.toFixed(1);
      return `<div class="twin-callout-row"><span>${sensorLabel(k)}</span><span>${shown} ${unitForKey(k)}</span></div>`;
    }).join('');
    el.style.display = '';
    el.innerHTML = `<div class="twin-callout-title">${part.label || partId}</div>${rows}`;

    // The card is anchored ABOVE the tap point (CSS translate(-50%,-100%)),
    // so clamp using its own measured size — otherwise a part near the top
    // or edge of the viewport pushes the card above/outside the twin
    // container, which clips it (overflow: hidden) and left only a sliver
    // of unreadable text showing, as happened before this fix.
    const r = this.el.getBoundingClientRect();
    const w = el.offsetWidth || 160;
    const h = el.offsetHeight || 90;
    const px = (proj.x * 0.5 + 0.5) * r.width;
    const py = (-proj.y * 0.5 + 0.5) * r.height;
    const x = Math.min(Math.max(px, w / 2 + 8), Math.max(w / 2 + 8, r.width - w / 2 - 8));
    const y = Math.min(Math.max(py - 20, h + 10), Math.max(h + 10, r.height - 14));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  /* ------------------------------------------------------------ events */
  _bindEvents() {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointermove', (e) => {
      const r = dom.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    dom.addEventListener('pointerleave', () => this.pointer.set(-9, -9));
    dom.addEventListener('click', () => { if (this.hovered) this.select(this.hovered); });
    window.addEventListener('resize', () => this.resize());
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.el);
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight || 480;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  select(partId) {
    this.selected = partId;
    // "Inspect burst": the part visually pops outward with an eased
    // animation, holds while the inspector panel shows its live values,
    // then automatically reassembles back into position after 6 seconds —
    // all while the engine keeps running underneath, untouched.
    this.burst = { partId, start: performance.now() };
    this._restartCalloutPop();
    if (this.onSelect) this.onSelect(partId, this.parts.get(partId)?.label || partId);
  }

  setMode(key, value) {
    this.mode[key] = value;
    if (key === 'cutaway') {
      this.cylinders.forEach(c => {
        c.barrel.material.transparent = value;
        c.barrel.material.opacity = value ? 0.22 : 1;
        c.head.material.transparent = value;
        c.head.material.opacity = value ? 0.35 : 1;
      });
      this.parts.get('crankcase').meshes.forEach(m => {
        if (m.geometry.type === 'BoxGeometry' && m.userData.label.includes('Crankcase')) {
          m.material.transparent = value; m.material.opacity = value ? 0.16 : 1;
        }
      });
    }
    if (key === 'labels') this.labelEls.forEach(l => l.el.style.display = value ? '' : 'none');
  }

  setFaults(faultParts) {         // Map partId -> severity
    this.faultParts = faultParts || new Map();
  }

  focus(partId) {
    const p = this.parts.get(partId); if (!p) return;
    const v = new THREE.Vector3();
    p.meshes[0].getWorldPosition(v);
    this.controls.target.lerp(v, 0.9);
  }

  update(tm) { this.tm = tm; }

  // When the backend simulation is paused, freeze the entire visual —
  // crank/piston/prop rotation, vibration jitter, exhaust flow, misfire
  // flash — instead of letting it keep spinning on the last known RPM.
  setRunning(v) { this.running = v; }

  /* ------------------------------------------------------------ loop */
  _animate() {
    if (this._disposed) return;
    requestAnimationFrame(() => this._animate());
    const dt = Math.min(0.05, this.clock.getDelta());
    const tm = this.tm;
    const t = performance.now() / 1000;

    if (tm && this.running) {
      // kinematics
      const rpm = tm.rpm || 0;
      this.crankAngle += (rpm / 60) * 2 * Math.PI * dt * 0.12;   // visually slowed 8x
      this.propAngle += (rpm / 2.43 / 60) * 2 * Math.PI * dt * 0.12;
      this.crank.rotation.z = this.crankAngle;
      this.prop.rotation.z = this.propAngle;
      this.turboSpin.rotation.z += dt * (2 + 14 * (tm.map_kpa || 40) / 140);

      // piston / rod motion (slider-crank)
      const r = 0.28, L = 0.62;
      this.cylinders.forEach((c, i) => {
        const phase = [0, Math.PI, Math.PI, 0][i];
        const th = this.crankAngle + phase;
        const x = r * Math.cos(th) + Math.sqrt(Math.max(0.001, L * L - (r * Math.sin(th)) ** 2));
        c.piston.position.y = 0.24 + x * 0.55;
        c.rod.position.y = c.piston.position.y - 0.34;
        c.rod.rotation.z = Math.asin((r * Math.sin(th)) / L) * 0.8;
      });

      // vibration response
      const vib = Math.min(3.5, tm.vib || 0);
      const amp = 0.004 + 0.012 * vib;
      this.root.position.set(Math.sin(t * 47) * amp, Math.sin(t * 61) * amp * 0.7, Math.cos(t * 53) * amp);
      this.root.rotation.z = Math.sin(t * 39) * amp * 0.35;

      // thermal shading (per cylinder)
      const cylT = tm.cylCHT || [tm.cht, tm.cht, tm.cht, tm.cht];
      this.cylinders.forEach((c, i) => {
        const k = Math.min(1, Math.max(0, (cylT[i] - 115) / 85));
        c.head.material.emissive.setRGB(k * 0.55, k * 0.11, 0);
        c.barrel.material.emissive.setRGB(k * 0.26, k * 0.04, 0);
        c.head.material.emissiveIntensity = 1;
      });
      // exhaust glow with EGT
      const eg = Math.min(1, Math.max(0, ((tm.egt || 400) - 620) / 400));
      this.parts.get('exhaust').meshes.forEach(m => m.material.emissive.setRGB(eg * 0.7, eg * 0.16, 0));

      // thermal mode: paint every part by its dominant temperature
      if (this.mode.thermal) {
        const map = { sump: tm.oil_t / 140, radiator: tm.coolant_t / 140, turbo: tm.egt / 1000,
          crankcase: tm.oil_t / 150, head: tm.cht / 190, exhaust: tm.egt / 1000 };
        this.parts.forEach((p, id) => {
          const k = Math.min(1, Math.max(0, map[id] ?? tm.cht / 200));
          p.meshes.forEach(m => m.material.color.setHSL((1 - k) * 0.62, 0.85, 0.45));
        });
      }

      // misfire flash on the sick cylinder
      if ((tm.misfire || 0) > 0.05 && Math.random() < tm.misfire * 0.9) {
        const c = this.cylinders[2];
        this.flash.position.set(c.group.position.x * 1.6, 1.1, c.group.position.z);
        this.flash.intensity = 6 + 12 * tm.misfire;
      }
      this.flash.intensity *= 0.86;

      // exhaust particle flow
      const pos = this.particles.geometry.attributes.position.array;
      const col = this.particles.geometry.attributes.color.array;
      const speed = 0.25 + 0.9 * (tm.throttle || 0.3);
      const cr = 0.35 + 0.65 * eg;
      for (let i = 0; i < this.flow.n; i++) {
        this.flow.u[i] += dt * speed * (0.6 + Math.random() * 0.5);
        if (this.flow.u[i] > 1) this.flow.u[i] -= 1;
        const lane = this.headers[this.flow.lane[i]];
        const p = lane.curve.getPoint(this.flow.u[i]);
        const j = 0.03;
        pos[i * 3] = p.x + (Math.random() - 0.5) * j;
        pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * j;
        pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * j;
        col[i * 3] = cr; col[i * 3 + 1] = 0.25 * cr; col[i * 3 + 2] = 0.12;
      }
      this.particles.geometry.attributes.position.needsUpdate = true;
      this.particles.geometry.attributes.color.needsUpdate = true;
    }

    // exploded view
    this.parts.forEach((p) => {
      p.meshes.forEach(m => {
        const home = m.userData.home;
        if (!home) return;
        const dir = home.clone().normalize().multiplyScalar(this.mode.exploded ? 0.45 : 0);
        m.position.lerp(home.clone().add(dir), 0.12);
      });
    });

    // inspect-burst: pop the selected part out, hold ~5.2s so the operator
    // can read live values off it, then ease back over 0.4s (6.0s total).
    // Skipped while global exploded mode is on to avoid double-offsetting.
    if (this.mode.exploded) {
      if (this.calloutEl) this.calloutEl.style.display = 'none';
    } else if (this.burst) {
      const elapsed = (performance.now() - this.burst.start) / 1000;
      const OUT = 0.4, HOLD = 5.2, BACK = 0.4;
      let k;
      if (elapsed < OUT) k = 1 - Math.pow(1 - elapsed / OUT, 3);
      else if (elapsed < OUT + HOLD) k = 1;
      else if (elapsed < OUT + HOLD + BACK) k = Math.max(0, 1 - (elapsed - OUT - HOLD) / BACK);
      else { k = 0; this.burst = null; }
      if (this.burst) {
        const part = this.parts.get(this.burst.partId);
        part?.meshes.forEach((m) => {
          const home = m.userData.home;
          if (!home) return;
          const len = home.length();
          const dir = len > 0.05 ? home.clone().normalize() : new THREE.Vector3(0, 1, 0);
          m.position.add(dir.multiplyScalar(0.85 * k));
        });
        this._renderCallout(this.burst.partId);
      } else if (this.calloutEl) {
        this.calloutEl.style.display = 'none';
      }
    } else if (this.calloutEl) {
      this.calloutEl.style.display = 'none';
    }

    // hover + selection + fault highlighting
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.root.children, true);
    const hitId = hits.length ? hits[0].object.userData.partId : null;
    this.hovered = hitId;
    this.renderer.domElement.style.cursor = hitId ? 'pointer' : 'default';

    const pulse = 0.5 + 0.5 * Math.sin(t * 4.4);
    this.parts.forEach((p, id) => {
      const sev = this.faultParts.get(id);
      p.meshes.forEach((m, k) => {
        if (!this.mode.thermal) {
          const base = p.baseColors[k];
          if (sev === 'alarm') m.material.color.copy(base).lerp(new THREE.Color(C.crit), 0.35 + 0.35 * pulse);
          else if (sev === 'warn') m.material.color.copy(base).lerp(new THREE.Color(C.warn), 0.25 + 0.25 * pulse);
          else if (id === this.selected) m.material.color.copy(base).lerp(new THREE.Color(C.accent), 0.45);
          else if (id === hitId) m.material.color.copy(base).lerp(new THREE.Color(0xffffff), 0.25);
          else m.material.color.copy(base);
        }
      });
    });

    // project labels
    if (this.mode.labels) {
      const r = this.el.getBoundingClientRect();
      for (const l of this.labelEls) {
        const v = l.v.clone().project(this.camera);
        const inFront = v.z < 1;
        l.el.style.display = inFront ? '' : 'none';
        const lw = l.el.offsetWidth || 120, lh = l.el.offsetHeight || 22;
        const x = Math.min(Math.max((v.x * 0.5 + 0.5) * r.width, lw * 0.5 + 6), r.width - lw * 0.5 - 6);
        const y = Math.min(Math.max((-v.y * 0.5 + 0.5) * r.height, lh * 0.5 + 6), r.height - lh * 0.5 - 6);
        l.el.style.left = `${x}px`;
        l.el.style.top = `${y}px`;
        const sev = this.faultParts.get(l.id);
        l.el.dataset.sev = sev || (this.selected === l.id ? 'sel' : '');
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
