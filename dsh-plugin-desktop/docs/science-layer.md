# Science layer (dsh-science)

This fork preinstalls a curated, locally conflict-verified research layer into
the desktop profile: 15 plugins and 20 skills, shipped inside the application
archive via the `dsh-science` workspace package.

## Composition

- `dsh-science` is a dependency of `dsh-plugin-desktop`; its vendored plugin
  packages are frozen `file:` dependencies, so Electron Builder places their
  physical copies under `app.asar.unpacked/node_modules`.
- `healProfilesModuleFallback` links the whole installation dependency graph
  into `$DSH_HOME/profiles/node_modules`, so the Profile composition layer
  resolves every science package by bare name through the Desktop/Profile
  overlay.
- `SCIENCE_BUNDLES` in `dsh-plugin-desktop/src/profile.ts` seeds the nine
  plugin bundles (plus `dsh-science` itself) into `dsh.profile.bundles` on
  every profile normalization. They are ordinary mutable bundles: operators
  can disable each one in Desktop plugin management.
- Six plugins without bundle metadata are registered through
  `dsh-science/cordis.patch.yml` rows.
- The `dsh-science` Host entry provisions the 20 skills into
  `$DSH_HOME/skills` on first boot, copy-if-missing, with a
  `.dsh-science.json` stamp. User content is never overwritten.

## License exceptions (verify-licenses)

The vendored `dsh-univer-office` fork depends on five `@univerjs-pro/*`
packages that publish no license metadata on npm. They are listed as
documented exceptions in `scripts/verify-licenses.mjs` on this basis:

- this repository is an owner-distributed internal build;
- the owner already operates the Univer Pro stack these binaries belong to;
- before any **public** release of the installers, either obtain
  redistribution rights for the Univer Pro binaries or move
  `dsh-univer-office` out of the preinstalled set into an optional add-on.

Every other production package passes the standard redistribution allowlist
(`OR` expressions pass when at least one branch is allowlisted).
