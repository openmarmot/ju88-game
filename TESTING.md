# Testing the Ju 88 sketch

Notes for a later AI session (or a human) that is changing this game. The loop is a static `index.html` + canvas, so there is no unit-test harness. Verification is: serve it, drive it, read the HUD, screenshot what the player would see.

This is what actually worked while building it. A couple of things that look official do **not** work.

## 1. Syntax first

```bash
node --check js/game.js
```

The game is an IIFE that talks to the DOM. `node --check` only proves it parses.

## 2. Serve it over HTTP

```bash
cd /Users/andrew/localdev/ju88-game
python3 -m http.server 8080
```

Open `http://127.0.0.1:8080/`. Do not rely on `file://` for agent checks — relative images load, but headless Chrome and screenshots are happier on HTTP.

Stop the server when you are done.

## 3. Built-in autopilot: `#autotest`

After assets load, if the URL hash is `#autotest`, `js/game.js` starts the mission and runs `driveAutotest()` every frame.

```
http://127.0.0.1:8080/#autotest
http://127.0.0.1:8080/#stalltest
```

`#autotest` skips the on-foot walk and boards immediately.

It will:

- start both Jumos
- set flaps TO, throttle to 1
- rotate when speed is near takeoff
- climb toward 280 m, then fly toward the depot
- drop SC 250s over the target
- come home, flaps LDG, brake on the strip

It is not a perfect landing AI. It **is** enough to prove engines, takeoff, heading, fuel burn, temp, and bombs without a keyboard.

The driver lives in `driveAutotest` in `js/game.js`. If takeoff/heat/stall numbers change, this function has to change with them — the first version sat at full throttle on the concrete long enough to seize both engines before rotate.

## 4. Do not use Chrome `--virtual-time-budget`

This looked like a shortcut and lied:

```bash
# BAD — do not use this as proof the sim ran
chrome --headless=new --virtual-time-budget=12000 --screenshot=out.png \
  http://127.0.0.1:8080/#autotest
```

`requestAnimationFrame` + `performance.now()` barely advanced. A 12 s “virtual” shot was the same as a 4 s shot: engines still `STARTING`, IAS 0. Treat any `--virtual-time-budget` result as a first-paint check only.

Use **wall-clock** waits.

## 5. Headless Chrome + puppeteer-core (what worked)

System Chrome on this machine:

`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

Install puppeteer-core somewhere throwaway (do not commit `node_modules` into this game):

```bash
mkdir -p /tmp/ju88_node
cd /tmp/ju88_node && npm install puppeteer-core --no-fund --no-audit
```

With the HTTP server already running:

```javascript
const puppeteer = require("puppeteer-core");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    args: ["--window-size=1440,900", "--hide-scrollbars"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE", m.text());
  });
  await page.goto("http://127.0.0.1:8080/#autotest", { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 6000));
  const st = await page.evaluate(() => ({
    ias: document.getElementById("ias").textContent,
    alt: document.getElementById("alt").textContent,
    roc: document.getElementById("roc").textContent,
    hdg: document.getElementById("hdg").textContent,
    thr: document.getElementById("thr").textContent,
    phase: document.getElementById("phase").textContent,
    rpm: document.getElementById("rpm-0").textContent,
    temp: document.getElementById("temp-0").textContent,
    state: document.getElementById("state-0").textContent,
    fuel: document.getElementById("fuel-total").textContent,
    warn: document.getElementById("warn").textContent,
  }));
  console.log(JSON.stringify(st));
  await page.screenshot({ path: "/tmp/ju88_airborne.png" });
  await browser.close();
})();
```

```bash
NODE_PATH=/tmp/ju88_node/node_modules node /tmp/your_script.js
```

Keep those scripts in `/tmp`. Do not commit them, and do not add a debug hook to `js/game.js`.

A briefing-only screenshot (no sim) is still useful:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --window-size=1440,900 \
  --screenshot=/tmp/ju88_briefing.png \
  http://127.0.0.1:8080/
```

## 5b. Inject a throwaway `window.__ju88` hook (what worked for UI / physics / phase)

`#autotest` is slow (a minute-plus to the depot) and does not always arrive. HUD ids cannot set altitude, flaps, or camera. The game is an IIFE, so `page.evaluate` cannot see `plane`.

What worked: intercept `js/game.js` and splice a hook **onto the end of the IIFE** before the closing `})();`. Closures inside the IIFE stay private; the hook is the only new global. Never leave this in the repo.

```javascript
const fs = require("fs");
const GAME = "/Users/andrew/localdev/ju88-game/js/game.js";

const HOOK = `
  window.__ju88 = {
    begin,
    snap(opts) {
      begin();
      engines[0].on = true;
      engines[0].power = opts.thrust != null ? opts.thrust / 2 : 0;
      engines[1].on = true;
      engines[1].power = opts.thrust != null ? opts.thrust / 2 : 0;
      plane.alive = true;
      plane.throttle = opts.throttle != null ? opts.throttle : 0;
      plane.x = opts.x != null ? opts.x : SPAWN.x;
      plane.y = opts.y != null ? opts.y : SPAWN.y;
      plane.hdg = opts.hdg != null ? opts.hdg : 90;
      plane.alt = opts.alt != null ? opts.alt : 0;
      plane.speed = opts.speed != null ? opts.speed : 0;
      plane.roc = 0;
      plane.elevator = 0;
      plane.flaps = opts.flaps != null ? opts.flaps : 0;
      plane.spinning = false;
      mission.airborne = plane.alt > 1;
      mission.bombsLeft = opts.bombs != null ? opts.bombs : 4;
      keys.KeyW = !!opts.w;
      keys.KeyS = !!opts.s;
    },
    look(x, y, z) {
      cam.x = x; cam.y = y; cam.z = z; cam.tz = z;
    },
    read() {
      return {
        alt: plane.alt,
        speed: plane.speed,
        ias: plane.speed * 1.76,
        roc: plane.roc,
        elev: plane.elevator,
        flaps: plane.flaps,
        phase: mission.phase,
        bombs: mission.bombsLeft,
      };
    },
  };
`;

await page.setRequestInterception(true);
page.on("request", async (req) => {
  if (req.url().includes("js/game.js")) {
    let body = fs.readFileSync(GAME, "utf8");
    if (!body.includes("window.__ju88")) {
      body = body.replace(/}\)\(\);\s*$/, HOOK + "\n})();\n");
    }
    await req.respond({
      status: 200,
      contentType: "application/javascript",
      body,
    });
    return;
  }
  await req.continue();
});
```

Every other request must `continue()` or the page hangs. The replace only matches the IIFE’s final `})();`.

Then:

```javascript
await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle0" });
await page.waitForFunction(() => window.__ju88);
await page.evaluate(() => __ju88.snap({ alt: 200, speed: 140, w: true, flaps: 0 }));
await new Promise((r) => setTimeout(r, 800)); // elevator and ROC lerp; wall clock
const st = await page.evaluate(() => __ju88.read());
await page.screenshot({ path: "/tmp/ju88_check.png" });
```

That is how phase (empty racks → RETURN), dive vs flaps (clean gains IAS, landing flaps bleed it), W/S stick, pause/manual, and runway paint were checked.

Things that lied or wasted a run:

- **Camera lerp.** `cam.x` / `cam.y` ease toward the plane every frame. Set `cam` once, wait 250 ms, and you are looking at spawn again. Either screenshot immediately, keep writing `cam` every frame, or move `plane.x/y` to the thing you want to see and let the lerp follow.
- **`#autotest` as a phase proof.** It can sit `EN ROUTE` for two minutes and never reach ATTACK. Inject `overTarget` / `bombsLeft` / `alt` instead.
- **`innerText` vs `textContent`.** Headings use `text-transform: uppercase`. `innerText` is `AERODYNAMICS`; the markup is `Aerodynamics`. Use `textContent` or match the rendered case.
- **Viewport mid-session.** `page.setViewport({ isMobile: true })` after a desktop load can report 0×0 for HUD buttons. Launch Chrome at the target size instead.
- **Overlay vs HUD.** `#help` sits above `#pause-btn`. Measure the pause button with the manual **closed**.

Stick (do not mix these up): **W** is stick forward / nose down / wheel brake on the ground. **S** is stick back / nose up / rotate / flare.

## 6. What to read off the HUD

Those element ids are the test API:

| id | meaning |
|---|---|
| `ias` | km/h |
| `alt` | metres |
| `roc` | m/s |
| `hdg` | degrees, 090 is east down the strip |
| `thr` | throttle % |
| `phase` | PREFLIGHT / TAKEOFF / EN ROUTE / ATTACK / RETURN / LANDING |
| `rpm-0` / `rpm-1` | port / stbd |
| `temp-0` / `temp-1` | oil °C |
| `state-0` / `state-1` | OFF, STARTING, RUNNING, SEIZED |
| `fuel-total` | litres remaining / 1680 |
| `warn` | stall, spin, oil hot, seized, fuel low |
| `mission-text` | the line under the phase |
| `pause-btn` | HUD pause; opens the manual and freezes the sim |
| `help` | flight manual overlay (class `hidden` when closed) |
| `help-kicker` | `Paused · flight manual` in flight, `Flight manual` on the briefing |
| `resume-btn` | closes the manual |
| `manual-btn` | briefing-only; same overlay, does not need the sim running |
| `.step.now` / `.step.done` | phase rail under the mission line |

A JS exception is painted in red on the canvas (see the `try/catch` in `frame()`). If rAF dies without that, check the puppeteer `pageerror` handler.

## 7. Checkpoints that meant it was actually flying

From a good `#autotest` run (wall clock, both engines, full throttle after ~1.4 s):

Around **6 s**

- `phase` is `EN ROUTE` or late `TAKEOFF`
- `alt` > 0 (we saw ~14–20 m)
- `ias` well above 140 (we saw ~220)
- `state-0` / `state-1` = `RUNNING`, not `SEIZED`
- `temp-*` warm but not cooking (we saw ~95 °C in the air)
- screenshot: exhaust **behind** the plane (west if heading 090), red bomb pipper **ahead** (east)

Around **13 s**

- still `RUNNING`
- still climbing (`alt` ~80–90 m, `roc` positive)
- `fuel-total` has dropped below 1680 (wing tanks first)
- `warn` empty
- heading still ~090 until it turns for the depot

If at 6 s you still have `STARTING` and `ias` 0, the sim is not stepping (virtual time, frozen rAF, or an exception).

If at ~8 s both engines are `SEIZED` on the runway, takeoff is too slow relative to ground heat. That happened once: full throttle on concrete, IAS 115, 142 °C, then dead Jumos. Heat and roll distance have to stay in the same ballpark (a few seconds of full power on the ground to rotate, seize if you sit there).

## 7b. HUD class names (yellow square bug)

The centre banner is `#warn`. Temperature bars use `.fill.is-warn` / `.fill.is-hot`, **not** class `warn`.

There used to be a `.warn` rule (`position: absolute; left: 50%; top: 78px`) and the temp fill also got class `warn` when oil was hot. The bar was yanked out of the 7 px track and drawn as a yellow rectangle over the Jumo panel. Do not put `warn` on those fills again.

When checking overheat, screenshot the left panel: the oil bar should stay inside the engine card and go yellow/red. There must not be a square sitting on top of Port/Stbd.

## 7c. Stall, spin, fire

Airborne and below stall: buffet and sink (`STALL` in `#warn`). If speed keeps falling (deep stall, or aileron at the stall), it autorotates (`SPIN`), heading winds, ROC goes hard negative.

Nose down (`W`) plus speed back above stall for ~0.7 s recovers. Holding `S` (stick back) in the stall makes it worse.

Landing:

- spinning into the ground → crash + fire (`Spun in. Fire in the tanks.`)
- sink rate ≳ 11 m/s → crash + fire (`Hard landing. The wing tanks went up.`)
- `crash()` always spawns a fire sprite on the wreck

`#autotest` is a happy-path takeoff; it will not cover spin. `#stalltest` takes off, then cuts throttle, holds the nose up, and kicks aileron so you can screenshot `SPIN` and a fire on impact.

Manual: after airborne, cut throttle and hold `S` until `warn` is `SPIN`, then either recover with `W` or hit the ground and look for fire.

`#stalltest` still holds the nose up after takeoff; `driveAutotest` uses `KeyS` for that now.

## 8. How to look at the plane

The Ju 88 sprite is nose-up in the PNG. In game, heading 0 is north, 90 is east down the runway.

The winter drawing is easy to misread at ~170 px. Do not trust “which way is the nose” from a glance. Trust:

- exhaust on the tail
- the red pipper ahead when airborne with bombs left
- the minimap heading mark
- HUD `hdg` (090 is east down the runway)

Spawn is `x=1420, y=5000, hdg=90` on the concrete. If the sprite looks “up” on the screen but those cues point east, it is rotated correctly.

## 9. Manual pass (still required for landing / bombing feel)

`#autotest` does not replace a hand flight. After an engine or physics change, actually:

1. Start port then starboard (`1` `2`). Confirm STARTING → RUNNING and RPM.
2. Leave it at idle on the ground: temp should climb slowly, not seize.
3. Full throttle while parked: oil should go warning then seize in roughly ten-plus seconds.
4. Takeoff roll on the grey strip, flaps TO (`F`), rotate with `S` around 140 IAS.
5. Climb out, watch temp fall with airspeed.
6. Fly east to the warehouse ring, drop with Space, confirm craters / fires.
7. Land on the same concrete, flare with `S`, `W` to brake, stop to complete.

`R` resets. Pause button / `H` / `P` freeze the sim and open the flight manual. `Esc` closes it.

RETURN / LANDING fire when the racks are empty **or** three buildings are down. ATTACK no longer sticks for the rest of the flight if you miss.

## 10. Assets

Sprites in `assets/` are PNG with real alpha (TWE art was black-keyed and trimmed). If a hangar or the Ju 88 suddenly has a black rectangle, the keying was lost — do not “fix” it by drawing a fill behind it.

Tiles (`grass.png`, `dirt.png`) were checked with a 2×2 composite. The dirt apron still has a mild repeating pattern; that is a known cosmetic, not a sim bug.

A `favicon.ico` 404 in the console is noise (`index.html` uses a data URI icon). Missing `assets/ju88.png` is not.

## 11. Audio

Engine drone is Web Audio. Headless Chrome will log “AudioContext was not allowed to start” until a user gesture. That is expected and not a test failure. `updateAudio` only tries `resume()` once so it does not spam the console every frame.
