/* Shared activation check for the CSS quote-request funnel.
 * Fails closed: any non-ok response, bad JSON, or timeout resolves to false,
 * so entry cards / product buttons / the form stay hidden.
 */
(function (root) {
  function checkActive(timeoutMs) {
    var hasAbort = typeof AbortController !== 'undefined';
    var ctrl = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 5000) : null;
    return fetch('/api/css-lead-notify', { method: 'GET', signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) return false;
        return r.json().then(function (d) { return !!(d && d.active === true); }).catch(function () { return false; });
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        return false;
      });
  }
  root.CssLeadActive = { check: checkActive };
}(typeof window !== 'undefined' ? window : this));
