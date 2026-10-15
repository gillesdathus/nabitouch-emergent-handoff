# Nabitouch frontend

React 19 application built with Vite. Yarn 1.22 is the package manager.

```bash
corepack yarn install
corepack yarn test
corepack yarn build
corepack yarn start
```

`yarn build` writes the static site to `frontend/build`, the same directory the existing deploy notes expect. Hashed files are under `build/assets`. `index.html` is not hashed.

The browser bundle only receives `REACT_APP_BACKEND_URL`, `REACT_APP_MAPBOX_PUBLIC_TOKEN`, and `REACT_APP_TRACKING_MODE`. A production build requires `REACT_APP_BACKEND_URL` to be an absolute `https` origin with no userinfo and no `/api` path. Local, loopback, and private hosts are refused, so a release bundle cannot call `undefined/api` or `localhost`. The deployment template uses `https://nabitouch.com`. A Mapbox value, when present, must be a public `pk.` token. An `sk.` token, a Stripe secret, or a MongoDB URL stops the build. Server secrets must not use the `REACT_APP_` prefix. Development still allows those three variables to be unset.

The dev server listens on port 3025. Relative `/api` requests are proxied to `DEV_API_PROXY`, or to `http://127.0.0.1:8000` when that variable is unset. `DEV_API_PROXY` is not included in the browser bundle.
