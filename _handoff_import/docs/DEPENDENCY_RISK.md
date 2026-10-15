# Dependency risk

Audit date: 12 October 2026. Tooling: `yarn audit --groups dependencies` and `pip-audit -r backend/requirements.txt`.

After the pins below, the frontend production audit reports 18 findings: 10 high (`braces`) and 8 moderate (`sprintf-js`). The previous 2 critical `shell-quote` findings and the high `svgo` findings are gone.

`react-scripts` is listed under `dependencies`, so Yarn counts its build and test tools as production packages. Those tools run while compiling or testing. They are not imported by the browser bundle.

## Resolved

| Package | Was | Now | Exposure |
|---|---|---|---|
| shell-quote | 1.9.0 | 1.12.0 | Create React App dev server and editor launcher. `quote()` is not called with visitor input. |
| svgo | 1.3.2 on the SVGR path | 2.8.4 | SVG optimization at build time. |
| postcss-selector-parser | 6.1.4 | 7.1.6 | CSS tooling inside the build. |
| pymongo | 4.6.3 | 4.18.3 | Database driver. |
| motor | 3.3.1 | 3.7.1 | Required to accept the patched pymongo. |
| fastapi / starlette | 0.110.1 / 0.37.2 | 0.143.0 / 1.7.0 | HTTP stack. Startup now uses a lifespan handler. |
| python-jose and ecdsa | installed, unused | removed | No application import. |

`pip-audit -r backend/requirements.txt` on Python 3.12, after these pins, reported no known vulnerabilities. The previous audit had 21 findings in pymongo 4.6.3, starlette 0.37.2, python-jose 3.5.0, and ecdsa 0.19.2.

## Accepted, no upstream fix

`braces` 3.0.3 (stack exhaustion on a deeply nested pattern) and `sprintf-js` 1.0.3 (unbounded precision) are inside Jest, webpack, and coverage tooling. The advisory metadata lists no patched release (`<0.0.0`). Nabitouch does not pass visitor text to those functions. Replacing Create React App would not remove `braces` if the new toolchain still uses `micromatch`. Accepted for the build machine only.

## Not a Vite migration

The critical finding had a supported upgrade inside the current build. A framework migration was not required to clear it.
