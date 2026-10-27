/* Chat: refresh every 10 seconds (simple polling, no paid realtime service) and send without reloading. */
(function () {
  var box = document.getElementById('chatbox');
  if (!box) return;
  var room = box.getAttribute('data-room');
  var isAdmin = box.getAttribute('data-admin') === '1';
  var me = box.getAttribute('data-me') || '';
  var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
  var err = document.getElementById('chaterr');

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  function render(list) {
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.textContent = '';
    if (!list.length) box.appendChild(el('p', 'muted', 'No messages yet. Say hello.'));
    list.forEach(function (m) {
      var d = el('div', 'msg' + (m.deleted ? ' deleted' : '') + (m.name === me ? ' mine' : ''));
      d.appendChild(el('span', 'avatar sm', (m.name || '?').charAt(0).toUpperCase()));
      var bub = el('div', 'bubble');
      bub.appendChild(el('span', 'who', m.name));
      if (m.admin) bub.appendChild(el('span', 'tag', 'Admin'));
      bub.appendChild(el('span', 'when', m.time));
      if (isAdmin && !m.deleted) {
        var f = el('form', 'inline-form'); f.method = 'post'; f.action = '/meeting-room/chat/' + room + '/delete/' + m.id;
        var h = el('input'); h.type = 'hidden'; h.name = '_csrf'; h.value = csrf; f.appendChild(h);
        var b = el('button', 'btn small red', 'Delete'); b.type = 'submit'; f.appendChild(b); bub.appendChild(document.createTextNode(' ')); bub.appendChild(f);
      }
      bub.appendChild(el('div', 'body', m.deleted ? 'Message removed by an administrator.' : m.body));
      d.appendChild(bub);
      box.appendChild(d);
    });
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
  function load() {
    fetch('/meeting-room/chat/' + room + '/messages', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j) render(j.messages); }).catch(function () {});
  }
  box.scrollTop = box.scrollHeight;
  setInterval(load, 10000);

  var form = document.getElementById('chatform');
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var input = document.getElementById('body'); var text = input.value.trim(); if (!text) return;
    err.textContent = '';
    fetch(form.action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ body: text }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) { if (x.ok) { input.value = ''; load(); } else err.textContent = x.j.error || 'Could not send.'; })
      .catch(function () { err.textContent = 'Could not send. Check your connection.'; });
  });
})();
