const entry = new URLSearchParams(window.location.search).get('entry');
if (['sync', 'filter', 'world'].includes(entry)) {
  await import('./main.js');
} else {
  await import('./entry-landing.js');
}
