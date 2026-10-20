// Flytten från den gamla adressen (coachassist.setterholm.se) till app.truppio.se.
//
// Webbläsaren håller inloggning (localStorage) och notiser isär per adress, så en vanlig
// omdirigering skulle logga ut alla. I stället får sidor på den gamla adressen en liten
// flyttsida som:
//   1. stänger av notiserna på den gamla adressen (annars kommer de dubbelt när man slår på
//      dem på den nya),
//   2. skickar vidare till samma sida på den nya adressen med inloggningen i adressens
//      #-del (som aldrig skickas till servern). Appen tar emot den i `takeMovedLogin`.
// /api/ (t.ex. kalenderprenumerationer och flikar som redan är öppna), /uploads/ och
// servicearbetaren fortsätter att fungera på den gamla adressen.
//
// OLD_HOSTS (kommaseparerade) och NEW_ORIGIN kan sättas som miljövariabler; OLD_HOSTS=""
// stänger av flytten.
import type express from 'express';

const OLD_HOSTS = (process.env.OLD_HOSTS ?? 'coachassist.setterholm.se')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
const NEW_ORIGIN = (process.env.NEW_ORIGIN || 'https://app.truppio.se').replace(/\/+$/, '');

const KEEP_ON_OLD_HOST = /^\/(api\/|uploads\/|sw\.js$)/;

export function isOldHost(hostHeader: string | undefined): boolean {
  const host = String(hostHeader || '').split(':')[0].toLowerCase();
  return OLD_HOSTS.includes(host);
}

function movedPage(): string {
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Truppio har flyttat</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f8fb; color: #0f1b2d;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
  @media (prefers-color-scheme: dark) { body { background: #0b1422; color: #e8eef7; } .card { background: #121e30 !important; border-color: #22324a !important; } }
  .card { max-width: 420px; margin: 16px; padding: 28px; background: #fff; border: 1px solid #e2e8f0; border-radius: 20px; }
  h1 { font-size: 1.4rem; margin: 0 0 8px; }
  p { margin: 0 0 14px; }
  a.btn { display: flex; align-items: center; justify-content: center; min-height: 48px; border-radius: 12px;
    background: #00b17e; color: #fff; font-weight: 700; text-decoration: none; margin-top: 18px; }
  ol { padding-left: 20px; margin: 0; }
  #standalone { display: none; }
</style>
</head>
<body>
<div class="card">
  <h1>Truppio har flyttat</h1>
  <p>Appen finns nu på <strong>app.truppio.se</strong>. Du är fortfarande inloggad.</p>
  <div id="standalone">
    <p>Du har appen på hemskärmen med den gamla adressen. Så här byter du:</p>
    <ol>
      <li>Tryck på knappen nedan.</li>
      <li>Lägg till Truppio på hemskärmen igen.</li>
      <li>Ta bort den gamla ikonen och slå på notiser i den nya.</li>
    </ol>
  </div>
  <a class="btn" id="go" href="${NEW_ORIGIN}/">Fortsätt till app.truppio.se</a>
</div>
<script>
(function () {
  var target = ${JSON.stringify(NEW_ORIGIN)} + location.pathname + location.search;
  var token = null, hadPush = false;
  try { token = localStorage.getItem('token'); } catch (e) {}
  try { hadPush = !!localStorage.getItem('coachassist.push'); localStorage.removeItem('coachassist.push'); } catch (e) {}
  var params = [];
  if (token) params.push('flytt=' + encodeURIComponent(token));
  if (hadPush) params.push('notiser=1');
  var href = target + (params.length ? '#' + params.join('&') : '');
  document.getElementById('go').href = href;

  // Stäng av notiserna på den gamla adressen (servern och enheten) och ta bort servicearbetaren.
  function turnOffOldPush() {
    if (!('serviceWorker' in navigator)) return Promise.resolve();
    return navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all(regs.map(function (reg) {
        var p = reg.pushManager ? reg.pushManager.getSubscription() : Promise.resolve(null);
        return p.then(function (sub) {
          if (!sub) return;
          var call = token ? fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ endpoint: sub.endpoint })
          }).catch(function () {}) : Promise.resolve();
          return call.then(function () { return sub.unsubscribe(); });
        }).catch(function () {}).then(function () { return reg.unregister(); });
      }));
    }).catch(function () {});
  }

  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var done = turnOffOldPush();
  if (standalone) {
    document.getElementById('standalone').style.display = 'block';
  } else {
    var timeout = new Promise(function (r) { setTimeout(r, 2500); });
    Promise.race([done, timeout]).then(function () { location.replace(href); });
  }
})();
</script>
</body>
</html>`;
}

/** Läggs först bland serverns mellanlager. */
export function movedFromOldHost(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!isOldHost(req.headers.host) || KEEP_ON_OLD_HOST.test(req.path)) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.type('html').send(movedPage());
}
