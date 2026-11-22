/* This worker only counts same-origin windows, including pages opened before
   installation. It never intercepts requests or claims an existing tab. */
self.addEventListener('message', event => {
  if (event.data !== 'history-window-count-v1' || !event.source || !event.ports[0]) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    event.ports[0].postMessage(windows.length === 1 && windows[0].id === event.source.id);
  }));
});
