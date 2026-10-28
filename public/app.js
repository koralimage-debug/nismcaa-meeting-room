/* NISMCAA Meeting Room: small progressive enhancements. Everything works without this file.
   No outside requests, no tracking. Motion is skipped when the visitor prefers reduced motion. */
(function () {
  var doc = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) doc.classList.add('js');

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  ready(function () {
    /* 1. Fade/slide in on scroll */
    if (!reduce && 'IntersectionObserver' in window) {
      var targets = $$('main .card, main .grid > *, main .journey .jstep, main .section-title, main .question, main .behind, main .tabs, main .table-wrap, main .note, main .cp-banner, main .course-text h3.lesson, main [data-reveal]');
      targets = targets.filter(function (t, i) { return targets.indexOf(t) === i && !t.closest('.hero'); });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
      var lastTop = -1, n = 0;
      targets.forEach(function (t) {
        var top = t.getBoundingClientRect().top;
        n = Math.abs(top - lastTop) < 40 ? n + 1 : 0; lastTop = top;
        t.style.setProperty('--d', Math.min(n, 5) * 70 + 'ms');
        t.setAttribute('data-reveal', '');
        io.observe(t);
      });
    }

    /* Count-up numbers on the reception page (the final number is already in the page; this only animates it) */
    var counters = $$('[data-count]');
    if (counters.length && !reduce && 'IntersectionObserver' in window) {
      var run = function (el) {
        var end = parseInt(el.getAttribute('data-count'), 10), t0 = null;
        var step = function (t) {
          if (t0 === null) t0 = t;
          var k = Math.min(1, (t - t0) / 1400), eased = 1 - Math.pow(1 - k, 3);
          el.textContent = Math.round(end * eased);
          if (k < 1) requestAnimationFrame(step); else el.textContent = end;
        };
        el.textContent = '0'; requestAnimationFrame(step);
      };
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { run(e.target); cio.unobserve(e.target); } });
      }, { threshold: 0.4 });
      counters.forEach(function (c) { cio.observe(c); });
      setTimeout(function () { counters.forEach(function (c) { if (c.textContent === '0') c.textContent = c.getAttribute('data-count'); }); }, 6000);
    }

    /* Door: tap the gold button, the lock opens, the doors swing, then the entry page opens (without JS the link just goes there) */
    var doorBtn = $('[data-door-open]');
    if (doorBtn && !reduce) {
      doorBtn.addEventListener('click', function (e) {
        var frame = doorBtn.closest('[data-door]');
        if (!frame || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        frame.classList.add('unlock');
        setTimeout(function () { frame.classList.add('swing'); }, 650);
        setTimeout(function () { window.location.href = doorBtn.getAttribute('href'); }, 2300);
      });
    }

    /* Safety net: never leave anything hidden if the observer is slow or misses an element */
    setTimeout(function () { $$('[data-reveal]').forEach(function (t) { t.classList.add('in'); }); }, 3500);

    /* 2. Header gets compact once you scroll */
    var head = $('#sitehead');
    if (head) {
      var onScroll = function () { head.classList.toggle('scrolled', window.scrollY > 24); };
      var setH = function () { doc.style.setProperty('--headh', Math.round(head.getBoundingClientRect().bottom) + 'px'); };
      onScroll(); setH(); window.addEventListener('scroll', function () { onScroll(); setH(); }, { passive: true }); window.addEventListener('resize', setH);
    }

    /* Meeting form: show only the fields that fit the chosen audience */
    var aud = $('[data-audience]');
    if (aud) {
      var sync = function () { $$('[data-show-for]').forEach(function (el) { el.hidden = el.getAttribute('data-show-for') !== aud.value; }); };
      aud.addEventListener('change', sync); sync();
    }

    /* 3. Show / hide password */
    $$('input[type=password]').forEach(function (inp) {
      var wrap = document.createElement('span'); wrap.className = 'pw';
      inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
      var b = document.createElement('button'); b.type = 'button'; b.className = 'pw-toggle'; b.textContent = 'Show'; b.setAttribute('aria-label', 'Show password');
      b.addEventListener('click', function () {
        var show = inp.type === 'password'; inp.type = show ? 'text' : 'password';
        b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
      wrap.appendChild(b);
    });

    /* 4. Course: sticky lesson progress bar */
    var bar = $('#lessonbar'), course = $('#course-text');
    if (bar && course) {
      var lessons = $$('h3.lesson', course);
      var label = $('#lessonbar-label'), pct = $('#lessonbar-pct'), fill = $('#lessonbar-fill'), pb = $('.bar', bar);
      bar.hidden = false;
      var upd = function () {
        var r = course.getBoundingClientRect(), vh = window.innerHeight;
        var total = r.height - vh * 0.6; var done = Math.min(Math.max(-r.top + vh * 0.2, 0), total);
        var p = total > 0 ? Math.round(done / total * 100) : 0;
        fill.style.width = p + '%'; pct.textContent = p + '%'; pb.setAttribute('aria-valuenow', p);
        var cur = 0;
        for (var i = 0; i < lessons.length; i++) { if (lessons[i].getBoundingClientRect().top < vh * 0.35) cur = i + 1; else break; }
        label.textContent = cur ? 'Lesson ' + cur + ' of ' + lessons.length + ': ' + lessons[cur - 1].textContent.replace(/^Lesson \d+:\s*/, '') : 'Volunteer information';
      };
      upd(); window.addEventListener('scroll', upd, { passive: true }); window.addEventListener('resize', upd);
    }

    /* 5. Test: progress bar and answered count */
    var tbar = $('#testbar'), form = tbar && tbar.closest('form');
    if (form) {
      var fl = $('#testbar-fill'), tl = $('#testbar-label'), tcp = $('#testbar-cp'), tb = $('#testbar .bar');
      var count = function () {
        var names = {}, cp = {};
        $$('input[type=radio]:checked', form).forEach(function (r) { names[r.name] = 1; var n = parseInt(r.name.slice(1), 10); if (n >= 41) cp[n] = 1; });
        var c = Object.keys(names).length, k = Object.keys(cp).length;
        fl.style.width = (c / 50 * 100) + '%'; tl.textContent = c + ' of 50 answered'; tb.setAttribute('aria-valuenow', c);
        tcp.textContent = k ? 'Child protection: ' + k + ' of 10' : '';
        $$('.question', form).forEach(function (q) { q.classList.toggle('answered', !!$('input:checked', q)); });
      };
      form.addEventListener('change', count); count();
    }

    /* 6. ID card: gentle 3D tilt that follows the finger or pointer */
    var tilt = $('#idtilt');
    if (tilt && !reduce) {
      var stage = tilt.parentNode;
      stage.addEventListener('pointermove', function (e) {
        var r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.transform = 'rotateY(' + (x * 10).toFixed(2) + 'deg) rotateX(' + (-y * 8).toFixed(2) + 'deg)';
        tilt.style.setProperty('--sx', (50 + x * 80) + '%');
      });
      stage.addEventListener('pointerleave', function () { tilt.style.transform = ''; });
    }

    /* 7. Buttons: press ripple position for the shine effect */
    $$('.btn').forEach(function (b) {
      b.addEventListener('pointerdown', function () { b.classList.add('pressed'); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { b.addEventListener(ev, function () { b.classList.remove('pressed'); }); });
    });

    /* 8. National anthems: tapping a flag plays that country's anthem. One at a time, gentle volume,
          never autoplay, audio is fetched only on tap (preload none). Sound on/off is remembered. */
    var anthemEls = $$('[data-anthem]');
    if (anthemEls.length) {
      var KEY = 'nismcaa-anthem-sound', sound = true, audio = null, current = null;
      try { sound = localStorage.getItem(KEY) !== 'off'; } catch (e) {}
      $$('[data-anthem-hint]').forEach(function (h) { h.hidden = false; });
      var bar = document.createElement('div');
      bar.className = 'anthem-bar'; bar.hidden = true; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Anthem player');
      bar.innerHTML = '<span class="anthem-msg" aria-live="polite"></span><button type="button" class="stop">Stop</button><button type="button" class="ghost snd"></button>';
      document.body.appendChild(bar);
      var msg = $('.anthem-msg', bar), stopB = $('.stop', bar), sndB = $('.snd', bar);
      var showBar = function (text, withStop) { msg.textContent = text; stopB.hidden = !withStop; bar.hidden = false; };
      var sndLabel = function () { sndB.textContent = sound ? 'Anthem sound: On' : 'Anthem sound: Off'; sndB.setAttribute('aria-pressed', sound ? 'true' : 'false'); anthemEls.forEach(function (b) { b.classList.toggle('off', !sound); }); };
      var reset = function () { anthemEls.forEach(function (b) { b.classList.remove('playing'); b.setAttribute('aria-label', 'Play anthem of ' + b.getAttribute('data-name')); }); current = null; };
      var stop = function () { if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } reset(); bar.hidden = true; };
      sndLabel();
      stopB.addEventListener('click', stop);
      sndB.addEventListener('click', function () { sound = !sound; try { localStorage.setItem(KEY, sound ? 'on' : 'off'); } catch (e) {} if (!sound) stop(); sndLabel(); showBar(sound ? 'Anthem sound is on. Tap a flag to listen.' : 'Anthem sound is off.', false); });
      var play = function (b) {
        var code = b.getAttribute('data-anthem'), name = b.getAttribute('data-name');
        if (current === code) { stop(); return; }
        if (!sound) { showBar('Anthem sound is off. Turn it on to listen.', false); return; }
        if (!audio) { audio = new Audio(); audio.preload = 'none'; audio.addEventListener('ended', stop); }
        audio.pause(); reset();
        audio.src = '/static/audio/' + code + '.mp3'; audio.volume = 0.4;
        current = code;
        anthemEls.forEach(function (e) { if (e.getAttribute('data-anthem') === code) { e.classList.add('playing'); e.setAttribute('aria-label', 'Stop anthem of ' + name); } });
        showBar('Playing the anthem of ' + name, true);
        var pr = audio.play();
        if (pr && pr.catch) pr.catch(function () { reset(); showBar('Sorry, this anthem is not available right now.', false); });
      };
      anthemEls.forEach(function (b) {
        b.addEventListener('click', function () { play(b); });
        b.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && b.tagName !== 'BUTTON') { e.preventDefault(); play(b); } });
      });
    }
  });
})();
