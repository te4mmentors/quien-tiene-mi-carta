/* Página pública del link de confirmación: funciona sin cuenta.
   Si quien la abre tiene sesión, el préstamo se guarda también en su cuenta ("Me prestaron"). */
"use strict";
(function () {
  const box = document.getElementById("box"), cta = document.getElementById("cta");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
  const fmtDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-CO", { day: "numeric", month: "long" }); };
  const fmtTs = iso => new Date(iso).toLocaleString("es-CO", { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).replace(/\.$/, "");
  const initials = s => s.split(/[\s,]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  const fail = (h, p) => { box.innerHTML = `<h1 style="font-size:1.5rem">${esc(h)}</h1><p class="muted" style="margin:0">${esc(p)}</p>`; cta.hidden = false; };

  const CFG = window.QTMC_CONFIG || {};
  const token = new URLSearchParams(location.search).get("t") || "";
  if (!token) return fail("Link incompleto", "Pídele a quien te lo envió que te lo mande de nuevo.");
  if (!window.supabase || !CFG.SUPABASE_URL || /TU-PROYECTO/.test(CFG.SUPABASE_URL)) return fail("No se pudo cargar", "Revisa tu conexión y vuelve a abrir el link.");
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  let session = null, flash = "";

  function draw(c) {
    const sender = c.sender || "Alguien";
    const loan = c.kind === "loan";
    const n = c.items.reduce((s, i) => s + i.qty, 0);
    const one = n === 1;
    const tot = c.items.reduce((s, i) => s + (Number(i.value) || 0) * i.qty, 0);
    const head = c.mine
      ? `Este es tu link para ${esc(c.person || "la otra persona")}`
      : loan ? `${esc(sender)} te prestó ${one ? "esta carta" : `estas ${n} cartas`}`
        : `${esc(sender)} dice que te devolvió ${one ? "esta carta" : `estas ${n} cartas`}`;
    const items = c.items.map(i => `<div class="citem">
        <div class="thumb" aria-hidden="true">${esc(initials(i.card))}</div>
        <div style="min-width:0"><div class="loan-title">${i.qty > 1 ? `<span class="mono">${i.qty}×</span> ` : ""}${esc(i.card)}</div>
          <div class="meta">${i.set ? `<span class="mono">${esc(i.set)}</span>` : ""}${i.foil ? `<span class="tag">Foil</span>` : ""}${loan && i.due ? `<span>Devolver el ${fmtDate(i.due)}</span>` : ""}</div></div>
        <span class="price">${i.value ? cop.format(i.value * i.qty) : ""}</span></div>`).join("");

    let action = "";
    if (c.mine) {
      action = `<p class="muted" style="margin:0">${c.responded_at ? `${esc(c.person || "La otra persona")} ya confirmó el ${fmtTs(c.responded_at)}.` : `Envíaselo a ${esc(c.person || "la otra persona")} para que confirme. Tú no necesitas tocar nada aquí.`}</p>
        <div class="actions"><a class="btn" href="./">Ir a mi cuenta</a></div>`;
    } else if (!c.responded_at) {
      const label = loan ? (one ? "Sí, la tengo" : "Sí, las tengo") : (one ? "Sí, la recibí" : "Sí, las recibí");
      const note = loan && session ? `Se ${one ? "guardará" : "guardarán"} en tu cuenta, en "Me prestaron".`
        : loan ? `Si algo no coincide, escríbele a ${esc(sender)} antes de confirmar.`
          : session ? `Si tienes este préstamo en tu cuenta, se marcará como devuelto.` : `Si falta alguna, escríbele a ${esc(sender)} antes de confirmar.`;
      action = `<div class="actions"><button class="btn primary" id="ok" type="button" style="min-height:48px;font-size:1rem">${label}</button></div>
        <span class="err" id="err" role="alert"></span><p class="hint" style="margin:0">${note}</p>`;
    } else {
      action = `<p class="big-ok">✓ ${loan ? (one ? "Confirmaste que la tienes" : "Confirmaste que las tienes") : (one ? "Confirmaste que la recibiste" : "Confirmaste que las recibiste")}</p>
        <p class="muted" style="margin:0">${fmtTs(c.responded_at)}. ${esc(sender)} ya puede verlo.</p>`;
      if (flash) action += `<p class="okmsg" style="margin:0">${esc(flash)}</p>`;
      if (loan && session && c.claimed) action += `<div class="actions"><a class="btn" href="./">Ver en mi cuenta</a></div>`;
      else if (loan && session) action += `<div class="actions"><button class="btn primary" id="claim" type="button">Guardar en mi cuenta</button></div><span class="err" id="err" role="alert"></span>`;
      else if (loan) action += `<div class="panel" style="background:var(--accent-soft);border:0;gap:10px">
          <strong>Guárdalo en tu cuenta</strong>
          <span class="muted">Así tienes a la mano qué cartas te prestaron y cuándo devolverlas.</span>
          <div class="actions"><a class="btn primary" href="./?claim=${encodeURIComponent(token)}">Entrar o crear cuenta</a></div></div>`;
      else if (session && c.linked) action += `<p class="okmsg" style="margin:0">En tu cuenta quedó marcada como devuelta.</p>`;
    }

    box.innerHTML = `<span class="eyebrow">${c.mine ? "Vista previa" : (c.person ? "Hola " + esc(c.person) : "Hola")}</span>
      <h1 style="font-size:clamp(1.5rem,6vw,2rem)">${head}</h1>
      <div class="citems">${items || `<p class="muted">Este préstamo ya no tiene cartas registradas.</p>`}</div>
      ${tot ? `<div class="panel-head"><span class="muted">Valor de referencia</span><span class="price">${cop.format(tot)}</span></div>` : ""}
      ${action}`;
    cta.hidden = !!session || c.mine || !c.responded_at || loan;

    const ok = document.getElementById("ok"), claim = document.getElementById("claim");
    const run = async (btn, busyText) => {
      btn.disabled = true; btn.textContent = busyText;
      const useClaim = loan && session;
      const { data, error } = await sb.rpc(useClaim ? "claim_confirmation" : "respond_confirmation", { p_token: token });
      if (error || !data) { btn.disabled = false; btn.textContent = "Intentar de nuevo"; document.getElementById("err").textContent = "No se pudo confirmar. Revisa tu conexión."; return; }
      if (useClaim) { flash = data.added ? `Listo, ${data.added === 1 ? "quedó guardada" : "quedaron guardadas"} en tu cuenta en "Me prestaron".` : ""; draw(data.confirmation); }
      else draw(data);
    };
    if (ok) ok.addEventListener("click", () => run(ok, "Confirmando…"));
    if (claim) claim.addEventListener("click", () => run(claim, "Guardando…"));
  }

  (async () => {
    try { const { data } = await sb.auth.getSession(); session = data.session; } catch (e) { session = null; }
    const { data, error } = await sb.rpc("get_confirmation", { p_token: token });
    if (error) return fail("No se pudo cargar", "Revisa tu conexión y vuelve a abrir el link.");
    if (!data) return fail("Este link ya no existe", "Puede que el préstamo se haya borrado. Pídele a quien te lo envió uno nuevo.");
    draw(data);
  })();
})();
