/* Ju 88 sketch — top-down TWE-style flight. Static HTML, no build. */

(() => {
  "use strict";

  const WORLD = { w: 16000, h: 10000 };
  const RUNWAY = { x: 1100, y: 4920, w: 2800, h: 160 };
  const APRON = { x: 900, y: 4680, w: 3200, h: 640 };
  const TARGET = { x: 12400, y: 5180, r: 420 };
  const SPAWN = { x: 1420, y: 5000, hdg: 90 };
  const PILOT_SPAWN = { x: 1580, y: 4848, hdg: 230 };
  const WALK_SPEED = 64;
  const BOARD_DIST = 42;
  const CAM_AIR = 0.72;
  const CAM_FOOT = 1.9;

  const STALL = 72;
  const TAKEOFF = 88;
  const MAX_AIR = 255;
  const MAX_GROUND = 52;
  const START_TIME = 1.35;
  const BOMB_MAX = 4;
  const TEMP_WARN = 118;
  const TEMP_SEIZE = 136;

  const VERSION = "0.2.0";
  const PHASES = ["PREFLIGHT", "TAKEOFF", "EN ROUTE", "ATTACK", "RETURN", "LANDING"];

  const $ = (id) => document.getElementById(id);
  const canvas = $("c");
  const ctx = canvas.getContext("2d");
  const mini = $("minimap");
  const mctx = mini.getContext("2d");

  const keys = Object.create(null);
  const assets = {};
  let grassPat = null;
  let dirtPat = null;
  let concPat = null;

  let running = false;
  let loopOn = false;
  let pausedHelp = false;
  let last = 0;
  let hudClock = 0;
  let cam = { x: SPAWN.x, y: SPAWN.y, z: 0.72, tz: 0.72 };
  let shake = 0;
  let time = 0;
  let audio = null;
  let autotest = null;

  let plane, engines, tanks, bombs, worldObjs, particles, explosions, craters, fires;
  let mission;
  let boarded = false;
  let pilot = null;

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function angNorm(a) {
    a %= 360;
    if (a < 0) a += 360;
    return a;
  }
  function headingRad(h) {
    return (h * Math.PI) / 180;
  }
  function fwd(h, dist) {
    const r = headingRad(h);
    return { x: Math.sin(r) * dist, y: -Math.cos(r) * dist };
  }
  function rotOffset(h, ox, oy) {
    const r = headingRad(h);
    const s = Math.sin(r);
    const c = Math.cos(r);
    return { x: ox * c - oy * s, y: ox * s + oy * c };
  }
  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.hypot(dx, dy);
  }
  function inRect(x, y, r) {
    return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
  }

  function groundType(x, y) {
    if (inRect(x, y, RUNWAY)) return "runway";
    if (inRect(x, y, APRON)) return "dirt";
    return "grass";
  }

  function reset() {
    time = 0;
    shake = 0;
    plane = {
      x: SPAWN.x,
      y: SPAWN.y,
      hdg: SPAWN.hdg,
      speed: 0,
      alt: 0,
      roc: 0,
      throttle: 0,
      elevator: 0,
      aileron: 0,
      flaps: 0,
      brake: 0,
      alive: true,
      crashed: false,
      landed: false,
      stallTime: 0,
      spinning: false,
      spinDir: 1,
      spinRecover: 0,
      drawW: 176,
      drawH: 128,
    };
    engines = [makeEngine("Port"), makeEngine("Stbd")];
    tanks = [
      { name: "Wing L", cap: 415, fuel: 415, side: 0 },
      { name: "Wing R", cap: 415, fuel: 415, side: 1 },
      { name: "Fuse L", cap: 425, fuel: 425, side: 0 },
      { name: "Fuse R", cap: 425, fuel: 425, side: 1 },
    ];
    bombs = [];
    particles = [];
    explosions = [];
    craters = [];
    fires = [];
    worldObjs = buildWorld();
    boarded = false;
    pilot = {
      x: PILOT_SPAWN.x,
      y: PILOT_SPAWN.y,
      hdg: PILOT_SPAWN.hdg,
      walking: false,
      draw: 12,
    };
    mission = {
      phase: "PREFLIGHT",
      airborne: false,
      bombsLeft: BOMB_MAX,
      targetsHit: 0,
      targetsNeed: 3,
      leftField: false,
      overTarget: false,
      dropped: false,
      returned: false,
      won: false,
      failed: false,
      failReason: "",
      messages: [],
    };
    cam.x = pilot.x;
    cam.y = pilot.y;
    cam.z = CAM_FOOT;
    cam.tz = CAM_FOOT;
    buildTankHud();
    buildSteps();
    updateBombDots();
    $("end").classList.add("hidden");
    $("warn").textContent = "";
    closeManual();
    syncHudMode();
  }

  function makeEngine(name) {
    return {
      name,
      on: false,
      starting: false,
      startT: 0,
      power: 0,
      temp: 8,
      overheat: 0,
      damaged: false,
      rpm: 0,
    };
  }

  function buildWorld() {
    const rng = mulberry32(1944);
    const objs = [];

    objs.push({ kind: "hangar", x: 1680, y: 4740, rot: 0, w: 210, h: 128 });
    objs.push({ kind: "hangar", x: 1980, y: 4740, rot: 0, w: 210, h: 128 });
    objs.push({ kind: "hangar", x: 2280, y: 4740, rot: 0, w: 210, h: 128 });

    const depot = [
      { kind: "warehouse", x: 12240, y: 5080, rot: 8, w: 200, h: 112, hp: 2, target: true },
      { kind: "warehouse", x: 12520, y: 5120, rot: -4, w: 200, h: 112, hp: 2, target: true },
      { kind: "warehouse", x: 12380, y: 5320, rot: 2, w: 200, h: 112, hp: 2, target: true },
      { kind: "building", x: 12680, y: 5280, rot: 12, w: 72, h: 64, hp: 1, target: true },
      { kind: "building", x: 12140, y: 5240, rot: -10, w: 72, h: 64, hp: 1, target: true },
      { kind: "building", x: 12740, y: 5080, rot: 0, w: 72, h: 64, hp: 1, target: true },
    ];
    for (const d of depot) objs.push(d);

    for (let i = 0; i < 90; i++) {
      const x = 400 + rng() * (WORLD.w - 800);
      const y = 400 + rng() * (WORLD.h - 800);
      if (inRect(x, y, APRON)) continue;
      if (dist(x, y, TARGET.x, TARGET.y) < 380) continue;
      objs.push({
        kind: "tree",
        x,
        y,
        rot: rng() * 360,
        w: 48 + rng() * 28,
        h: 42 + rng() * 22,
      });
    }
    for (let i = 0; i < 40; i++) {
      const x = 600 + rng() * (WORLD.w - 1200);
      const y = 600 + rng() * (WORLD.h - 1200);
      if (inRect(x, y, APRON)) continue;
      objs.push({
        kind: "blob",
        x,
        y,
        rot: rng() * 360,
        w: 140 + rng() * 120,
        h: 140 + rng() * 120,
      });
    }
    return objs;
  }

  function buildTankHud() {
    const root = $("tanks");
    root.innerHTML = "";
    tanks.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "tank-row";
      row.innerHTML = `<div class="label"><span>${t.name}</span><b id="tankv-${i}">${t.fuel | 0} L</b></div>
        <div class="bar"><div class="fill fuel" id="tankb-${i}"></div></div>`;
      root.appendChild(row);
    });
  }

  function buildSteps() {
    const root = $("steps");
    root.innerHTML = "";
    for (const p of PHASES) {
      const el = document.createElement("div");
      el.className = "step";
      el.dataset.phase = p;
      el.textContent = p;
      root.appendChild(el);
    }
  }

  function updateBombDots() {
    const root = $("bomb-dots");
    root.innerHTML = "";
    for (let i = 0; i < BOMB_MAX; i++) {
      const d = document.createElement("div");
      d.className = "bomb-dot" + (i >= mission.bombsLeft ? " empty" : "");
      root.appendChild(d);
    }
  }

  /* ---------- input ---------- */

  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === "Enter") {
      if (!running && $("help").classList.contains("hidden")) begin();
      else if (running && !boarded && !pausedHelp) tryBoard();
    }
    if (e.code === "KeyR") {
      reset();
      if (!running) begin();
    }
    if (e.code === "Escape" && !$("help").classList.contains("hidden")) {
      closeManual();
      return;
    }
    if (e.code === "KeyH" || e.code === "KeyP" || e.code === "Escape") {
      if (running || !$("briefing").classList.contains("hidden")) toggleManual();
    }
    if (!running || pausedHelp) return;
    if (e.code === "BracketLeft") cam.tz = clamp(cam.tz / 1.18, zoomLo(), zoomHi());
    if (e.code === "BracketRight") cam.tz = clamp(cam.tz * 1.18, zoomLo(), zoomHi());
    if (!boarded || !plane.alive) return;
    if (e.code === "Digit1") toggleEngine(0);
    if (e.code === "Digit2") toggleEngine(1);
    if (e.code === "Space") dropBomb();
    if (e.code === "KeyF") {
      plane.flaps = plane.flaps === 0 ? 0.5 : plane.flaps === 0.5 ? 1 : 0;
    }
  });
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });
  window.addEventListener("blur", () => {
    for (const k of Object.keys(keys)) keys[k] = false;
  });
  window.addEventListener(
    "wheel",
    (e) => {
      if (!running || pausedHelp) return;
      e.preventDefault();
      cam.tz = clamp(cam.tz * (e.deltaY > 0 ? 0.92 : 1.08), zoomLo(), zoomHi());
    },
    { passive: false }
  );

  $("version").textContent = "v" + VERSION;
  $("start-btn").addEventListener("click", begin);
  $("again-btn").addEventListener("click", () => {
    reset();
    begin();
  });
  $("pause-btn").addEventListener("click", () => {
    if (!running) return;
    $("pause-btn").blur();
    toggleManual();
  });
  $("manual-btn").addEventListener("click", () => toggleManual());
  $("resume-btn").addEventListener("click", closeManual);
  $("help").addEventListener("click", (e) => {
    if (e.target.id === "help") closeManual();
  });
  document.querySelectorAll(".eng-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (running && boarded && plane.alive && !pausedHelp) toggleEngine(Number(btn.dataset.eng));
    });
  });

  function clearKeys() {
    for (const k of Object.keys(keys)) keys[k] = false;
  }

  function zoomLo() {
    return boarded ? 0.28 : 0.7;
  }
  function zoomHi() {
    return boarded ? 1.6 : 2.6;
  }

  function hatchPos() {
    const o = rotOffset(plane.hdg, -40, -12);
    return { x: plane.x + o.x, y: plane.y + o.y };
  }

  function canBoard() {
    if (boarded || !pilot || !plane.alive || plane.alt > 1) return false;
    const h = hatchPos();
    return dist(pilot.x, pilot.y, h.x, h.y) < BOARD_DIST;
  }

  function tryBoard() {
    if (canBoard()) board();
  }

  function board() {
    if (boarded) return;
    boarded = true;
    cam.tz = CAM_AIR;
    if (autotest) {
      cam.x = plane.x;
      cam.y = plane.y;
      cam.z = CAM_AIR;
    }
    clearKeys();
    syncHudMode();
  }

  function syncHudMode() {
    $("hud").classList.toggle("on-foot", !boarded);
  }

  function worldToPlane(x, y) {
    const dx = x - plane.x;
    const dy = y - plane.y;
    const r = headingRad(plane.hdg);
    const c = Math.cos(r);
    const s = Math.sin(r);
    return { ox: dx * c + dy * s, oy: -dx * s + dy * c };
  }

  function inHatchZone(x, y) {
    const p = worldToPlane(x, y);
    return p.ox > -54 && p.ox < -14 && p.oy > -34 && p.oy < 10;
  }

  function inPlaneSolid(x, y) {
    const p = worldToPlane(x, y);
    const fuse = Math.abs(p.ox) < 16 && Math.abs(p.oy) < 62;
    const wing = Math.abs(p.ox) < 86 && p.oy > -18 && p.oy < 22;
    const tail = Math.abs(p.ox) < 36 && p.oy > 28 && p.oy < 62;
    return fuse || wing || tail;
  }

  function blockedAt(x, y) {
    if (x < 80 || y < 80 || x > WORLD.w - 80 || y > WORLD.h - 80) return true;
    for (const o of worldObjs) {
      if (o.kind === "blob" || o.kind === "tree" || o.destroyed) continue;
      if (Math.abs(x - o.x) < o.w * 0.42 && Math.abs(y - o.y) < o.h * 0.42) return true;
    }
    if (plane.alive && plane.alt < 1 && inPlaneSolid(x, y) && !inHatchZone(x, y)) return true;
    return false;
  }

  function duckAudio(on) {
    if (!audio) return;
    audio.master.gain.setTargetAtTime(on ? 0 : 0.07, audio.ac.currentTime, 0.06);
  }

  function openManual() {
    $("help").classList.remove("hidden");
    pausedHelp = running;
    $("help-kicker").textContent = running ? "Paused · flight manual" : "Flight manual";
    $("resume-btn").textContent = running ? "Resume — Esc" : "Close — Esc";
    clearKeys();
    duckAudio(true);
    $("help").scrollTop = 0;
    $("help").querySelector(".help-card").scrollTop = 0;
  }

  function closeManual() {
    $("help").classList.add("hidden");
    pausedHelp = false;
    last = performance.now();
    clearKeys();
    duckAudio(false);
  }

  function toggleManual() {
    if ($("help").classList.contains("hidden")) openManual();
    else closeManual();
  }

  function begin() {
    $("briefing").classList.add("hidden");
    $("hud").classList.remove("hidden");
    $("end").classList.add("hidden");
    closeManual();
    running = true;
    last = performance.now();
    startAudio();
    startLoop();
  }

  function startLoop() {
    if (loopOn) return;
    loopOn = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function toggleEngine(i) {
    const e = engines[i];
    if (e.damaged) return;
    if (e.on || e.starting) {
      e.on = false;
      e.starting = false;
      return;
    }
    if (fuelOnSide(i) <= 0.2) return;
    e.starting = true;
    e.startT = 0;
  }

  function fuelOnSide(side) {
    let n = 0;
    for (const t of tanks) if (t.side === side) n += t.fuel;
    return n;
  }
  function fuelTotal() {
    return tanks.reduce((s, t) => s + t.fuel, 0);
  }

  function pullFuel(side, amount) {
    let need = amount;
    const order = tanks.filter((t) => t.side === side).concat(tanks.filter((t) => t.side !== side));
    for (const t of order) {
      if (need <= 0) break;
      const take = Math.min(t.fuel, need);
      t.fuel -= take;
      need -= take;
    }
    return amount - need;
  }

  function attackComplete() {
    return mission.targetsHit >= mission.targetsNeed || mission.bombsLeft <= 0;
  }

  function dropBomb() {
    if (mission.bombsLeft <= 0 || plane.alt < 12 || !plane.alive) return;
    mission.bombsLeft--;
    mission.dropped = true;
    updateBombDots();
    const f = fwd(plane.hdg, 12);
    const r = headingRad(plane.hdg);
    bombs.push({
      x: plane.x + f.x,
      y: plane.y + f.y,
      vx: Math.sin(r) * plane.speed * 0.92,
      vy: -Math.cos(r) * plane.speed * 0.92,
      alt: plane.alt,
      fall: 2,
      hdg: plane.hdg,
      alive: true,
    });
  }

  /* ---------- sim ---------- */

  function frame(now) {
    try {
      const dt = clamp((now - last) / 1000, 0, 0.05);
      last = now;
      if (running && !pausedHelp) {
        if (autotest) driveAutotest(dt);
        update(dt);
      }
      render();
    } catch (err) {
      console.error(err);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#c4453c";
      ctx.font = "14px ui-monospace, monospace";
      const msg = err && err.stack ? err.stack : String(err);
      String(msg)
        .split("\n")
        .slice(0, 8)
        .forEach((line, i) => ctx.fillText(line, 24, 96 + i * 16));
    }
    requestAnimationFrame(frame);
  }

  function driveAutotest(dt) {
    autotest.t += dt;
    const t = autotest.t;
    if (t < 0.2) {
      if (!engines[0].on && !engines[0].starting) toggleEngine(0);
      if (!engines[1].on && !engines[1].starting) toggleEngine(1);
    }
    if (autotest.stall && (plane.alt > 50 || autotest.stalling)) {
      autotest.stalling = true;
      plane.throttle = 0;
      keys.KeyS = true;
      keys.KeyW = false;
      keys.KeyA = true;
      keys.KeyD = false;
      return;
    }
    if (t > 1.35 && t < 90) plane.throttle = 1;
    if (t > 1.35 && plane.flaps === 0) plane.flaps = 0.5;
    keys.KeyS = plane.alt < 0.6 ? plane.speed > TAKEOFF - 4 : plane.alt < 280;
    keys.KeyW = false;
    keys.KeyA = false;
    keys.KeyD = false;
    if (plane.alt > 50 && plane.flaps !== 0) plane.flaps = 0;
    if (plane.alt > 40) {
      const toTgt = Math.atan2(TARGET.x - plane.x, -(TARGET.y - plane.y)) * 180 / Math.PI;
      const toHome = Math.atan2(SPAWN.x - plane.x, -(SPAWN.y - plane.y)) * 180 / Math.PI;
      let want = attackComplete() ? angNorm(toHome) : angNorm(toTgt);
      let err = ((want - plane.hdg + 540) % 360) - 180;
      if (err > 8) keys.KeyA = true;
      else if (err < -8) keys.KeyD = true;
      if (plane.alt > 320) keys.KeyS = false;
      if (plane.alt > 380) keys.KeyW = true;
    }
    if (
      !attackComplete() &&
      mission.bombsLeft > 0 &&
      dist(plane.x, plane.y, TARGET.x, TARGET.y) < 520 &&
      plane.alt > 80 &&
      autotest.lastDrop !== Math.floor(t)
    ) {
      dropBomb();
      autotest.lastDrop = Math.floor(t);
    }
    if (attackComplete() && plane.alt > 30 && dist(plane.x, plane.y, SPAWN.x, SPAWN.y) < 1400) {
      plane.throttle = 0.25;
      plane.flaps = 1;
      if (plane.alt > 40) keys.KeyW = true;
      keys.KeyS = false;
    }
    if (plane.alt < 0.6 && dist(plane.x, plane.y, SPAWN.x, SPAWN.y) < 900 && attackComplete()) {
      keys.KeyW = true;
      plane.throttle = 0;
    }
  }

  function update(dt) {
    time += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 8);
    hudClock += dt;
    if (boarded) handleFlightInput(dt);
    else handlePilot(dt);
    updateEngines(dt);
    updatePhysics(dt);
    updateBombs(dt);
    updateParticles(dt);
    updateExplosions(dt);
    updateMission();
    const follow = boarded ? plane : pilot;
    cam.z = lerp(cam.z, cam.tz, 1 - Math.pow(0.001, dt));
    cam.x = lerp(cam.x, follow.x, 1 - Math.pow(0.0008, dt));
    cam.y = lerp(cam.y, follow.y, 1 - Math.pow(0.0008, dt));
    updateAudio();
    if (hudClock > 0.12) {
      hudClock = 0;
      refreshHud();
    }
  }

  function handlePilot(dt) {
    let dx = 0;
    let dy = 0;
    if (keys.KeyA) dx -= 1;
    if (keys.KeyD) dx += 1;
    if (keys.KeyW) dy -= 1;
    if (keys.KeyS) dy += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      const nx = pilot.x + dx * WALK_SPEED * dt;
      const ny = pilot.y + dy * WALK_SPEED * dt;
      if (!blockedAt(nx, ny)) {
        pilot.x = nx;
        pilot.y = ny;
      } else if (!blockedAt(nx, pilot.y)) {
        pilot.x = nx;
      } else if (!blockedAt(pilot.x, ny)) {
        pilot.y = ny;
      }
      pilot.hdg = angNorm((Math.atan2(dx, -dy) * 180) / Math.PI);
      pilot.walking = true;
    } else {
      pilot.walking = false;
    }
  }

  function handleFlightInput(dt) {
    if (!plane.alive) {
      plane.throttle = 0;
      plane.elevator = 0;
      plane.aileron = 0;
      plane.brake = 1;
      return;
    }
    const up = keys.ArrowRight || keys.KeyE || keys.Equal;
    const down = keys.ArrowLeft || keys.KeyQ || keys.Minus;
    if (up) plane.throttle = clamp(plane.throttle + dt * 0.55, 0, 1);
    if (down) plane.throttle = clamp(plane.throttle - dt * 0.55, 0, 1);

    if (keys.KeyS) plane.elevator = clamp(plane.elevator + dt * 2.4, -1, 1);
    else if (keys.KeyW && plane.alt > 1) plane.elevator = clamp(plane.elevator - dt * 2.4, -1, 1);
    else plane.elevator = lerp(plane.elevator, 0, 1 - Math.pow(0.02, dt));

    if (plane.alt < 1) {
      plane.brake = keys.KeyW ? 1 : 0;
      if (keys.KeyA) plane.aileron = 1;
      else if (keys.KeyD) plane.aileron = -1;
      else plane.aileron = lerp(plane.aileron, 0, 1 - Math.pow(0.0004, dt));
    } else {
      plane.brake = 0;
      if (keys.KeyA) plane.aileron = 1;
      else if (keys.KeyD) plane.aileron = -1;
      else plane.aileron = lerp(plane.aileron, 0, 1 - Math.pow(0.008, dt));
    }
  }

  function updateEngines(dt) {
    for (let i = 0; i < 2; i++) {
      const e = engines[i];
      if (e.starting) {
        e.startT += dt;
        e.power = 0.08 * (e.startT / START_TIME);
        e.rpm = 200 + e.startT * 400;
        if (e.startT >= START_TIME) {
          e.starting = false;
          e.on = fuelOnSide(i) > 0.2 && !e.damaged;
          if (!e.on) e.power = 0;
        }
        continue;
      }
      const want = e.on && !e.damaged ? plane.throttle : 0;
      e.power = lerp(e.power, want, 1 - Math.pow(e.on ? 0.08 : 0.001, dt));
      e.rpm = e.power > 0.02 ? 500 + e.power * 1900 : 0;

      if (e.on && !e.damaged) {
        const burn = (0.16 + e.power * 0.95) * dt;
        const got = pullFuel(i, burn);
        if (got < burn * 0.5) {
          e.on = false;
        }
      }

      const air = plane.alt > 2 ? clamp(plane.speed / 190, 0, 1) : 0;
      const ram = air * 28;
      let target = 8;
      if (e.on && !e.damaged) {
        target = 72 + e.power * 38 - ram;
        if (plane.alt < 2) target += e.power * 28;
      }
      const tau = e.temp < target ? 2.6 : 4.2;
      e.temp += (target - e.temp) * (1 - Math.exp(-dt / tau));

      if (e.temp > TEMP_SEIZE - 4 && e.on) e.overheat += dt;
      else e.overheat = Math.max(0, e.overheat - dt * 0.6);
      if (e.overheat > 2.8 && e.on) {
        e.damaged = true;
        e.on = false;
        e.power = 0;
        burstSmoke(plane.x, plane.y, 18);
        shake = 0.6;
      }

      if (e.on && e.power > 0.08) {
        emitExhaust(i, dt);
      }
    }
  }

  function emitExhaust(i, dt) {
    if (Math.random() > dt * (8 + engines[i].power * 14)) return;
    const side = i === 0 ? -30 : 30;
    const off = rotOffset(plane.hdg, side, -26);
    const back = fwd(plane.hdg, -6);
    particles.push({
      x: plane.x + off.x + back.x,
      y: plane.y + off.y + back.y,
      vx: back.x * 3 + (Math.random() - 0.5) * 8,
      vy: back.y * 3 + (Math.random() - 0.5) * 8,
      life: 0.7 + Math.random() * 0.5,
      age: 0,
      size: 6 + engines[i].power * 10,
      kind: engines[i].damaged || engines[i].temp > TEMP_WARN ? "dark" : "exh",
    });
  }

  function burstSmoke(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 20 + Math.random() * 80;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1.2 + Math.random(),
        age: 0,
        size: 12 + Math.random() * 18,
        kind: "dark",
      });
    }
  }

  function updatePhysics(dt) {
    const gType = groundType(plane.x, plane.y);
    const onGround = plane.alt < 0.6 && !plane.spinning && plane.roc > -8;
    const thrust = (engines[0].on && !engines[0].damaged ? engines[0].power : 0) +
      (engines[1].on && !engines[1].damaged ? engines[1].power : 0);
    const flaps = plane.flaps;
    const stall = STALL * (1 - flaps * 0.22);
    const takeoff = TAKEOFF * (1 - flaps * 0.18);

    let resist = 0.018;
    if (onGround) {
      resist = gType === "runway" ? 0.022 : gType === "dirt" ? 0.055 : 0.12;
    } else {
      resist = 0.01 + plane.speed * 0.00004 + flaps * 0.01;
    }

    const cruise = onGround
      ? gType === "runway"
        ? 48 + thrust * 52
        : gType === "dirt"
          ? 24 + thrust * 20
          : 12 + thrust * 8
      : MAX_AIR * (0.42 + thrust * 0.3);
    const vLim = onGround ? cruise : MAX_AIR * (1.12 - flaps * 0.44);

    if (thrust > 0.02) {
      const accel = onGround
        ? (16 + thrust * 24) * (gType === "grass" ? 0.4 : gType === "dirt" ? 0.7 : 1)
        : 22 + thrust * 28;
      const cap = onGround ? cruise : vLim;
      if (plane.speed < cap) {
        plane.speed += accel * dt * (1 - plane.speed / Math.max(30, cap));
      }
    }
    plane.speed -= plane.speed * resist * dt * 8;
    if (!onGround && plane.elevator > 0.15 && thrust < 0.7) {
      plane.speed -= plane.elevator * (8 + plane.speed * 0.22) * dt;
    }
    if (plane.brake && onGround) plane.speed -= 28 * dt;
    if (plane.speed < 0.2) plane.speed = 0;
    if (plane.speed > vLim) {
      plane.speed = lerp(plane.speed, vLim, 1 - Math.pow(0.02, dt));
    } else if (!onGround && plane.elevator >= -0.08 && plane.speed > cruise) {
      plane.speed = lerp(plane.speed, cruise, 1 - Math.pow(0.12, dt));
    }

    const yawAsym =
      ((engines[0].power - engines[1].power) * (onGround ? 8 : 14)) * (plane.speed > 4 ? 1 : 0);

    if (onGround) {
      plane.spinning = false;
      plane.stallTime = 0;
      plane.spinRecover = 0;
      let turn = 0;
      if (plane.speed > 1.2 || Math.abs(plane.aileron) > 0.2) {
        turn = plane.aileron * 42 * clamp(plane.speed / 18, 0.25, 1);
      }
      plane.hdg = angNorm(plane.hdg - (turn + yawAsym) * dt);
      if (plane.speed >= takeoff && plane.elevator > 0.25 && thrust > 0.55) {
        plane.alt = 0.8;
        plane.roc = 2 + thrust * 4;
        mission.airborne = true;
      } else {
        plane.alt = 0;
        plane.roc = 0;
      }
    } else {
      const flying = plane.speed >= stall;
      if (!flying) {
        plane.stallTime += dt;
        const deep = plane.speed < stall * 0.62;
        const held = plane.stallTime > 1.15 && plane.speed < stall * 0.82;
        const kicked = Math.abs(plane.aileron) > 0.55 && plane.stallTime > 0.45;
        if (!plane.spinning && (deep || held || kicked)) {
          plane.spinning = true;
          plane.spinRecover = 0;
          const bias = engines[1].power - engines[0].power + plane.aileron * 0.4;
          plane.spinDir = bias >= 0 ? 1 : -1;
          if (Math.abs(bias) < 0.05) plane.spinDir = Math.random() < 0.5 ? 1 : -1;
        }
      } else {
        plane.stallTime = Math.max(0, plane.stallTime - dt * 2);
      }

      if (plane.spinning) {
        if (flying && plane.elevator < -0.3) plane.spinRecover += dt;
        else plane.spinRecover = Math.max(0, plane.spinRecover - dt);
        if (flying && plane.spinRecover > 0.7) {
          plane.spinning = false;
          plane.spinRecover = 0;
          plane.stallTime = 0;
        }
      }

      let turn = 0;
      if (plane.spinning) {
        const oppose = -plane.spinDir * plane.aileron;
        const spinRate = 88 + (1 - clamp(plane.speed / stall, 0, 1)) * 70 - oppose * 18;
        turn = -plane.spinDir * spinRate;
        shake = Math.max(shake, 0.55);
      } else {
        turn = plane.aileron * (28 + plane.speed * 0.12) * (0.55 + flaps * 0.2);
      }
      plane.hdg = angNorm(plane.hdg - (turn + yawAsym) * dt);

      let roc = 0;
      if (plane.spinning) {
        roc = -16 - (stall - Math.min(plane.speed, stall)) * 0.35;
        plane.speed -= plane.speed * dt * 0.55;
        if (plane.elevator < -0.25) plane.speed += 14 * dt;
        else if (plane.elevator > 0.15) plane.speed -= 10 * dt;
        if (plane.speed < 14) plane.speed = 14;
        if (Math.random() < dt * 14) {
          const back = fwd(plane.hdg, -16);
          particles.push({
            x: plane.x + back.x,
            y: plane.y + back.y,
            vx: back.x * 3 + (Math.random() - 0.5) * 20,
            vy: back.y * 3 + (Math.random() - 0.5) * 20,
            life: 0.5 + Math.random() * 0.4,
            age: 0,
            size: 8 + Math.random() * 10,
            kind: "dark",
          });
        }
      } else if (flying) {
        if (plane.elevator >= 0) {
          roc = plane.elevator * (2.2 + thrust * 3.4) * (0.75 + flaps * 0.12);
        } else {
          const dive = 9 + plane.speed * 0.04 + flaps * 3;
          roc = plane.elevator * dive;
        }
        roc += (thrust - 0.85) * 1.6;
      } else {
        roc = -9 - (stall - plane.speed) * 0.22;
        shake = Math.max(shake, 0.35);
      }
      const rocSnap = plane.elevator > 0.2 && plane.roc < -2 ? 0.012 : 0.04;
      plane.roc = lerp(plane.roc, roc, 1 - Math.pow(rocSnap, dt));
      plane.alt += plane.roc * dt;
      if (!plane.spinning) {
        if (plane.roc > 0) plane.speed -= plane.roc * 0.55 * dt;
        else plane.speed += -plane.roc * (1.9 - flaps * 1.4) * dt;
      }
      if (plane.alt < 0) {
        const impact = -plane.roc;
        const fast = plane.speed;
        const onStrip = gType === "runway";
        const spunIn = plane.spinning;
        const hard = impact > 11 || spunIn || (!onStrip && fast > 55) || (onStrip && fast > 130 && impact > 8);
        plane.alt = 0;
        plane.spinning = false;
        if (hard) {
          const why = spunIn
            ? "Spun in. Fire in the tanks."
            : impact > 11
              ? "Hard landing. The wing tanks went up."
              : onStrip
                ? "Gear collapsed on landing."
                : "Came down off the strip.";
          crash(why);
        } else if (impact > 7) {
          shake = 0.8;
          plane.speed *= 0.55;
          plane.roc = 0;
        } else {
          plane.speed *= 0.85;
          plane.roc = 0;
        }
      }
      plane.alt = Math.min(plane.alt, 1200);
    }

    if (plane.speed > 0.05) {
      const f = fwd(plane.hdg, plane.speed * dt);
      plane.x += f.x;
      plane.y += f.y;
    }
    plane.x = clamp(plane.x, 80, WORLD.w - 80);
    plane.y = clamp(plane.y, 80, WORLD.h - 80);

    if (onGround && plane.alive && plane.speed > 8) {
      for (const o of worldObjs) {
        if (o.kind === "tree" || o.kind === "blob" || o.destroyed) continue;
        if (Math.abs(plane.x - o.x) < o.w * 0.4 && Math.abs(plane.y - o.y) < o.h * 0.4) {
          crash("Hit a building on the taxiway.");
        }
      }
    }
  }

  function crash(reason) {
    if (!plane.alive) return;
    plane.alive = false;
    plane.crashed = true;
    plane.speed = 0;
    plane.alt = 0;
    plane.roc = 0;
    for (const e of engines) {
      e.on = false;
      e.damaged = true;
    }
    shake = 1.2;
    burstSmoke(plane.x, plane.y, 28);
    explosions.push({ x: plane.x, y: plane.y, age: 0, life: 0.7, size: 90 });
    fires.push({ x: plane.x, y: plane.y, t: 0 });
    mission.failed = true;
    mission.failReason = reason;
    endMission(false, reason);
  }

  function updateBombs(dt) {
    for (const b of bombs) {
      if (!b.alive) continue;
      b.fall += 9.8 * dt;
      b.alt -= b.fall * dt;
      b.vx *= 1 - 0.12 * dt;
      b.vy *= 1 - 0.12 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.hdg = angNorm((Math.atan2(b.vx, -b.vy) * 180) / Math.PI);
      if (b.alt <= 0) {
        b.alive = false;
        b.alt = 0;
        explode(b.x, b.y);
      }
    }
  }

  function explode(x, y) {
    shake = Math.max(shake, 0.7);
    explosions.push({ x, y, age: 0, life: 0.55, size: 110 });
    craters.push({ x, y, r: 48 + Math.random() * 18 });
    burstSmoke(x, y, 16);
    for (const o of worldObjs) {
      if (!o.target || o.destroyed) continue;
      if (dist(x, y, o.x, o.y) < 110) {
        o.hp -= 1;
        if (o.hp <= 0) {
          o.destroyed = true;
          mission.targetsHit++;
          fires.push({ x: o.x, y: o.y, t: 0 });
        }
      }
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    particles = particles.filter((p) => p.age < p.life);
    if (particles.length > 220) particles.splice(0, particles.length - 220);
    for (const f of fires) f.t += dt;
  }

  function updateExplosions(dt) {
    for (const e of explosions) e.age += dt;
    explosions = explosions.filter((e) => e.age < e.life);
  }

  function impactPoint() {
    if (plane.alt < 8) return null;
    const t = Math.sqrt((2 * plane.alt) / 9.8);
    const r = headingRad(plane.hdg);
    const drag = Math.pow(0.88, t);
    return {
      x: plane.x + Math.sin(r) * plane.speed * t * drag,
      y: plane.y - Math.cos(r) * plane.speed * t * drag,
      t,
    };
  }

  function updateMission() {
    if (mission.failed || mission.won) return;
    const onStrip = inRect(plane.x, plane.y, RUNWAY);
    const nearHome = dist(plane.x, plane.y, SPAWN.x, SPAWN.y) < 900;
    const nearTgt = dist(plane.x, plane.y, TARGET.x, TARGET.y) < TARGET.r + 200;
    if (plane.alt > 20) mission.airborne = true;
    if (plane.x > RUNWAY.x + RUNWAY.w + 200) mission.leftField = true;
    if (nearTgt && plane.alt > 30) mission.overTarget = true;

    const done = attackComplete();
    let phase = "PREFLIGHT";
    if (engines.some((e) => e.on) && plane.alt < 1 && !mission.airborne) phase = "TAKEOFF";
    else if (mission.airborne && !done) phase = nearTgt ? "ATTACK" : "EN ROUTE";
    else if (done) phase = (nearHome || onStrip) && plane.alt < 80 ? "LANDING" : "RETURN";
    if (plane.alt > 1 && mission.airborne && phase === "PREFLIGHT") phase = "EN ROUTE";
    mission.phase = phase;

    if (
      done &&
      onStrip &&
      plane.alt < 0.6 &&
      plane.speed < 6 &&
      plane.alive
    ) {
      mission.won = true;
      mission.returned = true;
      endMission(true, "Down, locked, and the tanks still have B4 in them.");
    }
  }

  function endMission(win, text) {
    running = true;
    $("end-title").textContent = win ? "Mission complete" : "Aircraft lost";
    $("end-body").textContent =
      text +
      (win
        ? `${mission.targetsHit ? ` Depot wrecked (${mission.targetsHit} buildings).` : ""} Fuel remaining ${fuelTotal() | 0} L.`
        : mission.targetsHit
          ? ` You hit ${mission.targetsHit} buildings before it ended.`
          : "");
    $("end").classList.remove("hidden");
  }

  /* ---------- hud ---------- */

  function refreshHud() {
    $("ias").textContent = String(Math.round(plane.speed * 1.76));
    $("alt").textContent = String(Math.round(plane.alt));
    $("roc").textContent = (plane.roc >= 0 ? "+" : "") + plane.roc.toFixed(1);
    $("hdg").textContent = String(Math.round(plane.hdg)).padStart(3, "0");
    $("thr").textContent = String(Math.round(plane.throttle * 100));
    $("flaps").textContent = plane.flaps === 0 ? "UP" : plane.flaps === 0.5 ? "TO" : "LDG";
    $("phase").textContent = mission.phase;
    $("fuel-total").textContent = `${fuelTotal() | 0} / 1680 L`;

    const copy = {
      PREFLIGHT: boarded
        ? "1 and 2 start the Jumos. Q/E throttle. Taxi east on the concrete."
        : canBoard()
          ? "Enter — climb into the cockpit."
          : "Walk to the Ju 88 on the strip. Enter to climb in.",
      TAKEOFF: "Throttle up. Flaps TO with F. Rotate with S once IAS is around 140.",
      "EN ROUTE": "Climb out, turn east. Depot is the cluster of warehouses. Watch temps.",
      ATTACK: "Level at 200–400 m. Pipper is impact. Space releases one SC 250.",
      RETURN: "Come west, bleed speed, flaps LDG. Put it on the grey strip.",
      LANDING: "Keep the nose down the concrete. W to brake. Stop on the field to complete.",
    };
    $("mission-text").textContent = copy[mission.phase] || "";

    document.querySelectorAll(".step").forEach((el) => {
      const i = PHASES.indexOf(el.dataset.phase);
      const c = PHASES.indexOf(mission.phase);
      el.classList.toggle("now", el.dataset.phase === mission.phase);
      el.classList.toggle("done", i < c);
    });

    const warns = [];
    for (let i = 0; i < 2; i++) {
      const e = engines[i];
      const box = $("eng-" + i);
      const btn = box.querySelector(".eng-btn");
      $("rpm-" + i).textContent = e.rpm > 20 ? String(Math.round(e.rpm)) : "—";
      $("temp-" + i).textContent = `${Math.round(e.temp)}°C`;
      const bar = $("tempbar-" + i);
      const pct = clamp((e.temp - 8) / 140, 0, 1) * 100;
      bar.style.width = pct + "%";
      bar.className =
        "fill" +
        (e.temp > TEMP_SEIZE - 8 ? " is-hot" : e.temp > TEMP_WARN ? " is-warn" : "");
      const st = $("state-" + i);
      st.className = "eng-state";
      box.classList.toggle("hot", e.temp > TEMP_WARN);
      box.classList.toggle("ok", e.on && e.temp < TEMP_WARN);
      box.classList.toggle("dead", e.damaged);
      if (e.damaged) {
        st.textContent = "SEIZED";
        st.classList.add("hot");
        btn.textContent = "Dead";
        warns.push(e.name + " seized");
      } else if (e.starting) {
        st.textContent = "STARTING";
        btn.textContent = "Cut";
      } else if (e.on) {
        st.textContent = "RUNNING";
        st.classList.add("on");
        btn.textContent = "Cut";
        if (e.temp > TEMP_WARN) warns.push(e.name + " oil hot");
      } else {
        st.textContent = "OFF";
        btn.textContent = "Start";
      }
    }
    if (plane.spinning) warns.push("SPIN");
    else if (plane.alt > 2 && plane.speed < STALL) warns.push("STALL");
    if (fuelTotal() < 180) warns.push("FUEL LOW");
    $("warn").textContent = warns.join("  ·  ");

    tanks.forEach((t, i) => {
      $("tankv-" + i).textContent = `${t.fuel | 0} L`;
      $("tankb-" + i).style.width = (t.fuel / t.cap) * 100 + "%";
    });
  }

  /* ---------- render ---------- */

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  function worldToScreen(x, y) {
    return {
      x: (x - cam.x) * cam.z + canvas.width / 2,
      y: (y - cam.y) * cam.z + canvas.height / 2,
    };
  }

  function applyCam() {
    const jx = (Math.random() - 0.5) * shake * 10;
    const jy = (Math.random() - 0.5) * shake * 10;
    ctx.setTransform(cam.z, 0, 0, cam.z, canvas.width / 2 + jx, canvas.height / 2 + jy);
    ctx.translate(-cam.x, -cam.y);
  }

  function viewBounds() {
    const pad = 200;
    return {
      x: cam.x - canvas.width / 2 / cam.z - pad,
      y: cam.y - canvas.height / 2 / cam.z - pad,
      w: canvas.width / cam.z + pad * 2,
      h: canvas.height / cam.z + pad * 2,
    };
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#3a4a28";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    applyCam();
    const view = viewBounds();

    if (grassPat) {
      ctx.fillStyle = grassPat;
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    }

    if (dirtPat) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(APRON.x, APRON.y, APRON.w, APRON.h);
      ctx.clip();
      ctx.fillStyle = dirtPat;
      ctx.fillRect(APRON.x, APRON.y, APRON.w, APRON.h);
      ctx.restore();
    }

    drawRunway();
    drawRoad();

    for (const c of craters) {
      drawSprite("crater", c.x, c.y, c.r * 2.2, c.r * 2.2, 0, 0.92);
    }

    for (const o of worldObjs) {
      if (o.x + o.w < view.x || o.x - o.w > view.x + view.w) continue;
      if (o.y + o.h < view.y || o.y - o.h > view.y + view.h) continue;
      if (o.kind === "blob") {
        drawSprite("terrain_blob", o.x, o.y, o.w, o.h, o.rot, 0.55);
        continue;
      }
      if (o.destroyed) {
        drawSprite("crater", o.x, o.y, o.w * 0.9, o.h * 0.9, o.rot, 0.9);
        continue;
      }
      const img =
        o.kind === "hangar"
          ? "hangar"
          : o.kind === "warehouse"
            ? "warehouse"
            : o.kind === "building"
              ? "building"
              : "tree";
      drawSprite(img, o.x, o.y, o.w, o.h, o.rot, 1);
    }

    drawTargetRing();

    for (const f of fires) drawFire(f);
    for (const p of particles) drawParticle(p);
    for (const e of explosions) drawExplosion(e);
    for (const b of bombs) if (b.alive) drawBomb(b);

    drawPipper();
    drawPlane();
    drawPilot();
    drawLabels();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawMinimap();
  }

  function drawSprite(name, x, y, w, h, rot, alpha) {
    const img = assets[name];
    if (!img) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function drawRunway() {
    ctx.fillStyle = "#a7a293";
    ctx.fillRect(RUNWAY.x, RUNWAY.y, RUNWAY.w, RUNWAY.h);
    if (concPat) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = concPat;
      ctx.fillRect(RUNWAY.x, RUNWAY.y, RUNWAY.w, RUNWAY.h);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(90, 84, 72, 0.16)";
    ctx.lineWidth = 1;
    for (let x = RUNWAY.x + 80; x < RUNWAY.x + RUNWAY.w; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, RUNWAY.y);
      ctx.lineTo(x, RUNWAY.y + RUNWAY.h);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(240,240,230,0.9)";
    const cy = RUNWAY.y + RUNWAY.h / 2;
    const thresh = 72;
    const dashW = 36;
    for (let x = RUNWAY.x + thresh; x + dashW <= RUNWAY.x + RUNWAY.w - thresh; x += 70) {
      ctx.fillRect(x, cy - 2, dashW, 4);
    }
    ctx.fillStyle = "#ece6d0";
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(RUNWAY.x + 18, RUNWAY.y + 10 + i * 18, 46, 6);
      ctx.fillRect(RUNWAY.x + RUNWAY.w - 64, RUNWAY.y + 10 + i * 18, 46, 6);
    }
  }

  function drawRoad() {
    ctx.save();
    ctx.strokeStyle = "#8a7a58";
    ctx.lineWidth = 38;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(RUNWAY.x + RUNWAY.w, 5000);
    ctx.lineTo(11800, 5120);
    ctx.lineTo(TARGET.x - 80, TARGET.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawTargetRing() {
    ctx.save();
    ctx.strokeStyle = "rgba(180, 50, 40, 0.45)";
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(TARGET.x, TARGET.y, TARGET.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(180,50,40,0.75)";
    ctx.font = "22px ui-monospace, monospace";
    ctx.fillText("SUPPLY DEPOT", TARGET.x - 80, TARGET.y - TARGET.r - 12);
    ctx.restore();
  }

  function drawLabels() {
    ctx.save();
    ctx.fillStyle = "rgba(230,220,180,0.8)";
    ctx.font = "18px ui-monospace, monospace";
    ctx.fillText("FELDFLUGPLATZ HOLM", APRON.x + 24, APRON.y - 16);
    ctx.restore();
  }

  function drawPlane() {
    if (plane.alt > 16) {
      const off = 6 + plane.alt * 0.16;
      ctx.save();
      ctx.translate(plane.x + off, plane.y + off);
      ctx.rotate(headingRad(plane.hdg));
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.ellipse(0, 0, plane.drawW * 0.34, plane.drawH * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const scale = 1 + clamp(plane.alt / 1800, 0, 0.12);
    const spinWobble = plane.spinning ? Math.sin(time * 18) * 12 : 0;
    drawSprite(
      "ju88",
      plane.x,
      plane.y,
      plane.drawW * scale,
      plane.drawH * scale,
      plane.hdg + spinWobble,
      plane.alive ? 1 : 0.7
    );
    if (!plane.alive) {
      drawSprite("explosion", plane.x, plane.y, 70, 70, 0, 0.8);
    }
  }

  function drawPilot() {
    if (boarded || !pilot) return;
    const bob = pilot.walking ? Math.sin(time * 16) * 0.35 : 0;
    drawSprite("pilot", pilot.x, pilot.y + bob, pilot.draw, pilot.draw, pilot.hdg, 1);
    if (canBoard()) {
      ctx.save();
      ctx.fillStyle = "rgba(230, 220, 180, 0.95)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("ENTER to board", pilot.x, pilot.y - 10);
      ctx.restore();
    }
  }

  function drawBomb(b) {
    const img = assets.sc250up || assets.sc250;
    if (!img) return;
    const len = 36 + b.alt * 0.04;
    const wid = Math.max(7, len * (img.width / img.height));
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(headingRad(b.hdg));
    ctx.drawImage(img, -wid / 2, -len / 2, wid, len);
    ctx.restore();
    if (b.alt > 8) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(b.x + b.alt * 0.2, b.y + b.alt * 0.2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPipper() {
    const p = impactPoint();
    if (!p || plane.alt < 20 || mission.bombsLeft <= 0) return;
    ctx.save();
    ctx.strokeStyle = "rgba(220, 70, 50, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.moveTo(p.x - 16, p.y);
    ctx.lineTo(p.x + 16, p.y);
    ctx.moveTo(p.x, p.y - 16);
    ctx.lineTo(p.x, p.y + 16);
    ctx.stroke();
    ctx.restore();
  }

  function drawParticle(p) {
    const t = 1 - p.age / p.life;
    ctx.save();
    ctx.globalAlpha = t * 0.45;
    const img = assets.smoke;
    if (img) {
      const s = p.size * (1 + p.age);
      ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
    } else {
      ctx.fillStyle = p.kind === "dark" ? "#555" : "#ccc";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawExplosion(e) {
    const t = e.age / e.life;
    const s = e.size * (0.4 + t * 1.4);
    ctx.save();
    ctx.globalAlpha = 1 - t;
    const img = assets.explosion;
    if (img) ctx.drawImage(img, e.x - s / 2, e.y - s / 2, s, s);
    ctx.restore();
  }

  function drawFire(f) {
    const flicker = 0.7 + Math.sin(f.t * 9 + f.x) * 0.2;
    ctx.save();
    ctx.globalAlpha = 0.55 * flicker;
    if (assets.explosion) {
      const s = 36 + Math.sin(f.t * 6) * 6;
      ctx.drawImage(assets.explosion, f.x - s / 2, f.y - s / 2, s, s);
    }
    if (assets.smoke) {
      const s = 50 + (f.t % 3) * 8;
      ctx.globalAlpha = 0.3;
      ctx.drawImage(assets.smoke, f.x - s / 2, f.y - s - 10, s, s);
    }
    ctx.restore();
  }

  function drawMinimap() {
    const w = mini.width;
    const h = mini.height;
    mctx.fillStyle = "#1c2214";
    mctx.fillRect(0, 0, w, h);
    const sx = w / WORLD.w;
    const sy = h / WORLD.h;
    mctx.fillStyle = "#8a7a58";
    mctx.fillRect(APRON.x * sx, APRON.y * sy, APRON.w * sx, APRON.h * sy);
    mctx.fillStyle = "#b0aa9a";
    mctx.fillRect(RUNWAY.x * sx, RUNWAY.y * sy, RUNWAY.w * sx, RUNWAY.h * sy);
    mctx.strokeStyle = "#b04030";
    mctx.beginPath();
    mctx.arc(TARGET.x * sx, TARGET.y * sy, TARGET.r * sx, 0, Math.PI * 2);
    mctx.stroke();
    mctx.fillStyle = boarded ? "#d7d3bc" : "#8a8a78";
    mctx.beginPath();
    mctx.arc(plane.x * sx, plane.y * sy, 3.5, 0, Math.PI * 2);
    mctx.fill();
    const mark = boarded || !pilot ? plane : pilot;
    if (!boarded && pilot) {
      mctx.fillStyle = "#c4a35a";
      mctx.beginPath();
      mctx.arc(pilot.x * sx, pilot.y * sy, 2.6, 0, Math.PI * 2);
      mctx.fill();
    }
    const f = fwd(mark.hdg, 9);
    mctx.strokeStyle = "#c4a35a";
    mctx.beginPath();
    mctx.moveTo(mark.x * sx, mark.y * sy);
    mctx.lineTo(mark.x * sx + f.x * sx * 40, mark.y * sy + f.y * sy * 40);
    mctx.stroke();
    mctx.strokeStyle = "#5c6144";
    mctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  /* ---------- audio ---------- */

  function startAudio() {
    if (audio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ac;
    try {
      ac = new AC();
    } catch (e) {
      return;
    }
    const master = ac.createGain();
    master.gain.value = 0.07;
    master.connect(ac.destination);
    try {
      const make = (freq) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        const f = ac.createBiquadFilter();
        o.type = "sawtooth";
        o.frequency.value = freq;
        f.type = "lowpass";
        f.frequency.value = 400;
        g.gain.value = 0;
        o.connect(f);
        f.connect(g);
        g.connect(master);
        o.start();
        return { o, g, f };
      };
      audio = { ac, master, a: make(48), b: make(53) };
    } catch (e) {
      audio = null;
    }
  }

  function updateAudio() {
    if (!audio) return;
    if (audio.ac.state === "suspended") {
      if (audio.triedResume) return;
      audio.triedResume = true;
      audio.ac.resume().catch(() => {});
    }
    for (let i = 0; i < 2; i++) {
      const e = engines[i];
      const node = i === 0 ? audio.a : audio.b;
      const on = e.on || e.starting;
      const vol = on ? 0.35 + e.power * 0.65 : 0;
      node.g.gain.setTargetAtTime(vol, audio.ac.currentTime, 0.08);
      node.o.frequency.setTargetAtTime(42 + e.rpm * 0.04, audio.ac.currentTime, 0.1);
      node.f.frequency.setTargetAtTime(280 + e.power * 900, audio.ac.currentTime, 0.1);
    }
  }

  /* ---------- load ---------- */

  const NAMES = [
    "ju88",
    "pilot",
    "sc250",
    "hangar",
    "warehouse",
    "building",
    "tree",
    "concrete",
    "dirt",
    "grass",
    "crater",
    "explosion",
    "smoke",
    "terrain_blob",
    "road",
  ];

  function loadImage(name) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(name));
      img.src = "assets/" + name + ".png";
    });
  }

  Promise.all(NAMES.map((n) => loadImage(n).then((img) => (assets[n] = img))))
    .then(() => {
      const c1 = document.createElement("canvas");
      const makePat = (img) => {
        const c = document.createElement("canvas");
        c.width = 256;
        c.height = 256;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0, 256, 256);
        return ctx.createPattern(c, "repeat");
      };
      const makeBombUpright = (img) => {
        const c = document.createElement("canvas");
        c.width = img.height;
        c.height = img.width;
        const g = c.getContext("2d");
        g.translate(c.width / 2, c.height / 2);
        g.rotate(-Math.PI / 2);
        g.drawImage(img, -img.width / 2, -img.height / 2);
        return c;
      };
      const makeConcretePat = (img) => {
        const s = 72;
        const c = document.createElement("canvas");
        c.width = s;
        c.height = s;
        const g = c.getContext("2d");
        g.fillStyle = "#a7a293";
        g.fillRect(0, 0, s, s);
        const trim = 4;
        g.drawImage(
          img,
          trim,
          trim,
          img.width - trim * 2,
          img.height - trim * 2,
          0,
          0,
          s,
          s
        );
        return ctx.createPattern(c, "repeat");
      };
      grassPat = makePat(assets.grass);
      dirtPat = makePat(assets.dirt);
      concPat = makeConcretePat(assets.concrete);
      assets.sc250up = makeBombUpright(assets.sc250);
      reset();
      startLoop();
      if (location.hash === "#autotest" || location.hash === "#stalltest") {
        autotest = { t: 0, lastDrop: -1, stall: location.hash === "#stalltest" };
        board();
        begin();
      }
    })
    .catch((err) => {
      console.error(err);
      reset();
      startLoop();
    });
})();
