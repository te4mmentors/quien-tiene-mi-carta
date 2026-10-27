/* Página pública del link de confirmación: no requiere cuenta. */
"use strict";
(function () {
  const box = document.getElementById("box"), cta = document.getElementById("cta");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
  const fmtDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-CO", { day: "numeric", month: "long" }); };
  const fmtTs = iso => new Date(iso).toLocaleString("es-CO", { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
  const initials = s => s.split(/[\s,]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  const fail = (h, p) => { box.innerHTML = `<h1 style="font-size:1.5rem">${esc(h)}</h1><p class="muted" style="margin:0">${esc(p)}</p>`; cta.hidden = false; };

  const CFG = window.QTMC_CONFIG || {};
  const token = new URLSearchParams(location.search).get("t") || "";
  if (!token) return fail("Link incompleto", "Pídele a quien te lo envió que te lo mande de nuevo.");
  if (!window.supabase || !CFG.SUPABASE_URL || /TU-PROYECTO/.test(CFG.SUPABASE_URL)) return fail("No se pudo cargar", "Revisa tu conexión y vuelve a abrir el link.");
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

  function draw(c) {
    const sender = c.sender || "Alguien";
    const loan = c.kind === "loan";
    const n = c.items.reduce((s, i) => s + i.qty, 0);
    const tot = c.items.reduce((s, i) => s + (Number(i.value) || 0) * i.qty, 0);
    const head = loan
      ? `${esc(sender)} te prestó ${n === 1 ? "esta carta" : `estas ${n} cartas`}`
      : `${esc(sender)} dice que te devolvió ${n === 1 ? "esta carta" : `estas ${n} cartas`}`;
    const items = c.items.map(i => `<div class="citem">
        <div class="thumb" aria-hidden="true">${esc(initials(i.card))}</div>
        <div style="min-width:0"><div class="loan-title">${i.qty > 1 ? `<span class="mono">${i.qty}×</span> ` : ""}${esc(i.card)}</div>
          <div class="meta">${i.set ? `<span class="mono">${esc(i.set)}</span>` : ""}${i.foil ? `<span class="tag">Foil</span>` : ""}${loan && i.due ? `<span>Devolver el ${fmtDate(i.due)}</span>` : ""}</div></div>
        <span class="price">${i.value ? cop.format(i.value * i.qty) : ""}</span></div>`).join("");
    const done = c.responded_at
      ? `<p class="big-ok">✓ ${loan ? "Confirmaste que las tienes" : "Confirmaste que las recibiste"}</p><p class="muted" style="margin:0">${fmtTs(c.responded_at)}. ${esc(sender)} ya puede verlo.</p>`
      : `<div class="actions"><button class="btn primary" id="ok" type="button" style="min-height:48px;font-size:1rem">${loan ? (n === 1 ? "Sí, la tengo" : "Sí, las tengo") : (n === 1 ? "Sí, la recibí" : "Sí, las recibí")}</button></div>
         <span class="err" id="err" role="alert"></span>
         <p class="hint" style="margin:0">${loan ? `Si algo no coincide, escríbele a ${esc(sender)} antes de confirmar.` : `Si falta alguna, escríbele a ${esc(sender)} antes de confirmar.`}</p>`;
    box.innerHTML = `<span class="eyebrow">${c.person ? "Hola " + esc(c.person) : "Hola"}</span>
      <h1 style="font-size:clamp(1.5rem,6vw,2rem)">${head}</h1>
      <div class="citems">${items || `<p class="muted">Este préstamo ya no tiene cartas registradas.</p>`}</div>
      ${tot ? `<div class="panel-head"><span class="muted">Valor de referencia</span><span class="price">${cop.format(tot)}</span></div>` : ""}
      ${done}`;
    cta.hidden = !c.responded_at;
    const ok = document.getElementById("ok");
    if (ok) ok.addEventListener("click", async () => {
      ok.disabled = true; ok.textContent = "Confirmando…";
      const { data, error } = await sb.rpc("respond_confirmation", { p_token: token });
      if (error || !data) { ok.disabled = false; ok.textContent = "Intentar de nuevo"; document.getElementById("err").textContent = "No se pudo confirmar. Revisa tu conexión."; return; }
      draw(data);
    });
  }

  sb.rpc("get_confirmation", { p_token: token }).then(({ data, error }) => {
    if (error) return fail("No se pudo cargar", "Revisa tu conexión y vuelve a abrir el link.");
    if (!data) return fail("Este link ya no existe", "Puede que el préstamo se haya borrado. Pídele a quien te lo envió uno nuevo.");
    draw(data);
  });
})();
