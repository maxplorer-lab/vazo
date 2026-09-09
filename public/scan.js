function scanMedia() {
  // Delegate to the admin-controlled background job (see scan.ts / reconcile.ts in relief)
  // For vazo: just inform the user that scanning must be done by the admin via the worker console.
  alert("Media scanning is an admin-only operation. Ask the site administrator to run the reconcile job via the Cloudflare dashboard.");
}
