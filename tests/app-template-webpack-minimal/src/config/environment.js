// `<modulePrefix>/config/environment` must be the *same* ENV object that the
// app (router.js, app.js) and tests (enterTestMode) mutate via `#config`.
// Re-exporting from `#config` guarantees a single shared ENV object even if
// webpack would otherwise create a distinct module instance for this path.
export { default, enterTestMode } from '#config';
