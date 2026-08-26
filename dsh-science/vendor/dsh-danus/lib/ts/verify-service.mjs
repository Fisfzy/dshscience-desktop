// Generated JS bridge: lets the Cordis Loader (plain import(), no TS support
// under node_modules) reach the TypeScript host entry through tsx's esbuild
// transform. The plugin uses Cordis named exports (apply/Config/name/inject),
// so the whole module namespace is re-exported as the default plugin object.
// Runtime paths stay anchored at src/** so asset and worker resolution
// (spawn of src/swarm/loop-main.ts via --import tsx/esm) is intact.
import { tsImport } from 'tsx/esm/api'
export default await tsImport(new URL('../../src/plugins/verify-service.ts', import.meta.url).href, import.meta.url)
