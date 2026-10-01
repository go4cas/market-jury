// Quiver's router runs on the Navigation API (Chrome and Edge 102+, Safari 26.2+, Firefox 147+).
if (!('navigation' in window)) {
  document.getElementById('app').innerHTML =
    '<p style="max-width:32rem;margin:4rem auto;padding:0 1rem;font-family:sans-serif;line-height:1.5">' +
    'Market Jury needs a newer browser. Please update to a current version of Chrome, Edge, Safari or Firefox.</p>'
}
