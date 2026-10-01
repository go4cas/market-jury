// Terminal (dark) unless the viewer picked Daylight. Loaded in <head> so it applies before first paint.
// A file rather than an inline script so the Content-Security-Policy can allow scripts from this site only.
try {
  if (localStorage.getItem('ui-mode') === 'light') document.documentElement.dataset.mode = 'light'
} catch (e) { /* storage blocked: Terminal applies */ }
