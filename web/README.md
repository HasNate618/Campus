# web/

The Campus frontend: React 19, TypeScript, Vite 8 and Tailwind v4, with UI
primitives from Radix.

The API serves the built bundle from `web/dist` on the same origin as `/api`,
so a production build is complete once `npm run build` finishes.

## Commands

```bash
npm ci            # install from the lockfile
npm run dev       # Vite dev server on :5173, proxies /api to the API
npm run build     # type-check, then build into web/dist
npm test          # node --test unit tests in src/lib/*.test.ts
npm run lint      # oxlint
```

`npm run dev` targets `http://127.0.0.1:8000` for the API proxy, falling back
to `http://127.0.0.1:8010` when nothing healthy answers on the first port. Set
`CAMPUS_API_TARGET` to override both.

## Notes

The `npm test` script uses `node --test "src/lib/*.test.ts"`, which needs Node
22 for glob expansion and built-in TypeScript type stripping.

`vite.config.ts` injects the git short SHA into `index.html` as
`<meta name="build">`, so the UI can show which bundle it is running. Set
`BUILD_SHA` when building outside a git checkout.
