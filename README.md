# Ju 88 — Feldflugplatz Holm

A top-down flight sim. Twin Jumo 211s, four tanks, four SC 250s. Walk to the aeroplane, climb in, take off from the strip, bomb the supply depot to the east, and land back on the concrete.

Each engine starts idependently. Watch oil temperature — a Jumo sitting at full throttle on the ground will seize.

Plane, hangars, depot and bomb art from [TWE](https://github.com/openmarmot/twe).

## Run

No build. Serve the folder over HTTP:

```bash
python3 -m http.server 8080
```

Then open [http://127.0.0.1:8080/](http://127.0.0.1:8080/).

## Controls

| Key | Action |
| --- | --- |
| Enter | Start the mission. On foot, climb into the Ju 88 |
| W A S D | Walk (on foot). The world does not rotate |
| 1 / 2 | Start or stop port / starboard engines |
| Q E · ← → | Throttle |
| W | In the cockpit: stick forward, nose down. Wheel brake on the ground |
| S | Stick back, nose up |
| A D | In the cockpit: wheel steering on the ground, aileron turn in the air |
| F | Flaps up / takeoff / landing |
| Space | Release one SC 250 |
| [ ] / mouse wheel | Zoom |
| H / P / Pause | Pause and open the flight manual |
| Esc | Close the manual |
| R | Restart |

Throttle stays where you leave it. Stall long enough and it spins — nose down (W) to recover. A hard landing or spinning in starts a fire.

The **Pause** button (or H / P) freezes the sim and opens a manual with the full control list and how the wing, flaps, and engines behave. There is also a Flight manual button on the briefing.

## Testing

See [TESTING.md](TESTING.md) for the `#autotest` hash, headless Chrome notes, and what not to use.

## License

[Unlicense](LICENSE) — public domain.
