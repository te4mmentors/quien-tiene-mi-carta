/* ¿Quién tiene mi carta? · app principal
   - Con Supabase configurado (config.js): cuentas con email y contraseña, datos en la nube, links de confirmación.
   - Sin configurar: modo demo, todo se guarda en este navegador. */
"use strict";

// ---------- Utilidades ----------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const daysUntil = s => { const [y, m, d] = s.split("-").map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d) - t) / 864e5); };
const fmtDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-CO", { day: "numeric", month: "short" }).replace(/\.$/, ""); };
const shortDate = iso => new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short" }).replace(/\.$/, "");
const whenStr = iso => ymd(new Date(iso)) === ymd(new Date()) ? "hoy" : "el " + shortDate(iso);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const initials = s => s.split(/[\s,]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
const dirOf = l => l.dir === "in" ? "in" : "out";
const val = l => (l.value || 0) * (l.qty || 1);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const plural = (n, a, b) => n === 1 ? a : b;
const keyOf = s => norm(s).replace(/[^a-z0-9]+/g, "_");

let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2800); }
async function copyFrom(pre) {
  try { await navigator.clipboard.writeText(pre.textContent); toast("Mensaje copiado"); }
  catch (x) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Mensaje seleccionado, cópialo"); }
}

function status(l) {
  if (l.returnedAt) return { k: "devuelta", label: "Devuelta" };
  if (!l.due) return { k: "prestada", label: "Sin fecha" };
  const d = daysUntil(l.due);
  if (d < 0) return { k: "vencida", label: `Vencida hace ${-d} ${plural(-d, "día", "días")}` };
  if (d === 0) return { k: "pronto", label: "Vence hoy" };
  if (d <= 3) return { k: "pronto", label: `Vence en ${d} ${plural(d, "día", "días")}` };
  return { k: "prestada", label: `Hasta el ${fmtDate(l.due)}` };
}

const TXT = {
  out: {
    form: "Prestar una carta", person: "Se la presto a", due: "¿Cuándo la devuelve?", submit: "Registrar préstamo",
    cfYes: "Confirmó el", cfNo: "Sin confirmar", ask: "Pedir confirmación", askDone: "Ya respondió OK",
    askHint: "Envíale este mensaje. Cuando toque el link y confirme, aquí se marca solo. Si te responde OK por WhatsApp, también puedes marcarlo tú.",
    batchAsk: n => `Pedir confirmación de ${n} en un mensaje`,
    batchHint: "Un solo mensaje con todas las cartas sin confirmar. Cuando confirme en el link, se marcan todas.",
    ret: "Me la devolvió", retGroup: "Me devolvió cartas", retHint: "Marca las cartas que te devolvió. Si quieres, mándale el agradecimiento.",
    who: "a", emptyH: "No tienes cartas prestadas", emptyP: "Registra arriba qué carta prestaste, a quién y para cuándo."
  },
  in: {
    form: "Registrar una carta que me prestaron", person: "Me la presta", due: "¿Cuándo la devuelvo?", submit: "Registrar lo que me prestaron",
    cfYes: "Le avisé el", cfNo: "Sin avisar", ask: "Avisar que la recibí", askDone: "Ya le avisé",
    askHint: "Avísale que la recibiste y cuándo se la devuelves. Así queda constancia en el chat.",
    batchAsk: n => `Avisar que recibí ${n} en un mensaje`,
    batchHint: "Un solo mensaje confirmando todas las cartas que te prestó.",
    ret: "La devolví", retGroup: "Devolver cartas", retHint: "Envíale el mensaje. Cuando confirme en el link que las recibió, aquí se marcan como devueltas solas. Si prefieres, márcalas tú ya.",
    who: "de", emptyH: "No tienes cartas de otros", emptyP: "Si alguien te presta una carta para un torneo, regístrala aquí para no olvidar devolverla."
  }
};

// ---------- Configuración y sesión ----------
const CFG = window.QTMC_CONFIG || {};
const CONFIGURED = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/TU-PROYECTO|TU-CLAVE/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY));
const sb = CONFIGURED && window.supabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
const APP_BASE = location.origin + location.pathname.replace(/[^/]*$/, "");
let me = null;        // { id, name, email }
const CLAIM_KEY = "qtmc-claim";
(function () {
  const t = new URLSearchParams(location.search).get("claim");
  if (!t) return;
  try { localStorage.setItem(CLAIM_KEY, t); } catch (e) { }
  history.replaceState(null, "", location.pathname);
})();
const pendingClaim = () => { try { return localStorage.getItem(CLAIM_KEY); } catch (e) { return null; } };
let loans = [], store = null;
const myName = () => me?.name || "";

// ---------- Almacenamiento ----------
const FIELD = { dir: "dir", card: "card", set: "set_code", person: "person", phone: "phone", qty: "qty", value: "value", foil: "foil", due: "due", note: "note", confirmedAt: "confirmed_at", returnedAt: "returned_at", returnConfirmedAt: "return_confirmed_at", createdAt: "created_at", example: "example" };
const fromRow = r => ({ id: r.id, dir: r.dir, card: r.card, set: r.set_code || "", person: r.person, phone: r.phone || "", qty: r.qty, value: Number(r.value) || 0, foil: !!r.foil, due: r.due || "", note: r.note || "", confirmedAt: r.confirmed_at || "", returnedAt: r.returned_at || "", returnConfirmedAt: r.return_confirmed_at || "", createdAt: r.created_at, example: !!r.example });
const toRow = d => { const o = {}; for (const k in d) if (FIELD[k]) { let v = d[k]; if ((k === "due" || k.endsWith("At")) && v === "") v = null; o[FIELD[k]] = v; } return o; };

function cloudStore() {
  const T = sb.from.bind(sb);
  return {
    async load() { const { data, error } = await T("loans").select("*").order("created_at", { ascending: true }); if (error) throw error; loans = data.map(fromRow); render(); },
    async add(d) { const { data, error } = await T("loans").insert(toRow(d)).select().single(); if (error) throw error; loans.push(fromRow(data)); render(); return data.id; },
    async update(id, p) { const { error } = await T("loans").update(toRow(p)).eq("id", id); if (error) throw error; loans = loans.map(l => l.id === id ? { ...l, ...p } : l); render(); },
    async remove(id) { const { error } = await T("loans").delete().eq("id", id); if (error) throw error; loans = loans.filter(l => l.id !== id); render(); },
    async token(ids, kind) { const { data, error } = await sb.rpc("create_confirmation", { p_loan_ids: ids, p_kind: kind, p_sender: myName() }); if (error) throw error; return data; }
  };
}
function localStore() {
  const LS = "qtmc-loans-v1";
  const write = () => { try { localStorage.setItem(LS, JSON.stringify(loans)); } catch (e) { } };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return {
    async load() { try { loans = JSON.parse(localStorage.getItem(LS) || "[]"); } catch (e) { loans = []; } render(); },
    async add(d) { const id = uid(); loans.push({ id, ...d }); write(); render(); return id; },
    async update(id, p) { loans = loans.map(l => l.id === id ? { ...l, ...p } : l); write(); render(); },
    async remove(id) { loans = loans.filter(l => l.id !== id); write(); render(); },
    async token() { return null; } // sin servidor no hay link de confirmación
  };
}

// ---------- Links de confirmación (se generan al abrir el panel) ----------
const tokenCache = new Map(); // clave -> {state:"loading"|"ready"|"none", url}
function linkFor(kind, ids) {
  if (!ids.length) return { state: "none" };
  const k = kind + ":" + [...ids].sort().join(",");
  let e = tokenCache.get(k);
  if (!e) {
    e = { state: "loading" }; tokenCache.set(k, e);
    Promise.resolve(store.token(ids, kind))
      .then(t => { e.state = t ? "ready" : "none"; e.url = t ? APP_BASE + "c.html?t=" + encodeURIComponent(t) : ""; })
      .catch(() => { e.state = "none"; })
      .finally(() => render());
  }
  return e;
}

// ---------- Vistas: login / app ----------
function show(view) { for (const v of ["authView", "appView", "fatalView"]) $("#" + v).hidden = v !== view; }
function showForm(id) { show("authView"); $("#claimNote").hidden = !pendingClaim(); for (const f of ["fLogin", "fSignup", "fForgot", "fNewPass"]) $("#" + f).hidden = f !== id; $$(".auth .err,.auth .okmsg").forEach(e => e.textContent = ""); const first = $("#" + id + " input"); if (first) first.focus(); }
$$("[data-go]").forEach(b => b.addEventListener("click", () => showForm(b.dataset.go)));

function authError(e) {
  const m = (e && (e.message || e.error_description)) || "";
  if (/invalid login credentials/i.test(m)) return "Email o contraseña incorrectos.";
  if (/email not confirmed/i.test(m)) return "Primero confirma tu correo con el link que te enviamos.";
  if (/already registered|already been registered/i.test(m)) return "Ya existe una cuenta con ese email. Entra o recupera tu contraseña.";
  if (/password/i.test(m) && /(least|short|weak|characters)/i.test(m)) return "La contraseña es muy corta o débil. Usa al menos 8 caracteres.";
  if (/rate limit|too many/i.test(m)) return "Demasiados intentos. Espera un minuto e intenta de nuevo.";
  if (/valid email|invalid email|email address/i.test(m)) return "Revisa el email, parece que no es válido.";
  if (/fetch|network/i.test(m)) return "Sin conexión. Revisa tu internet e intenta de nuevo.";
  return m ? "No se pudo completar: " + m : "No se pudo completar. Intenta de nuevo.";
}
function formBusy(form, busy) { const b = form.querySelector("button[type=submit]"); b.disabled = busy; b.style.opacity = busy ? .6 : 1; }
const validEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

$("#fLogin").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, err = f.querySelector(".err");
  const email = $("#liEmail").value.trim(), password = $("#liPass").value;
  if (!validEmail(email)) { err.textContent = "Escribe tu email."; return; }
  if (!password) { err.textContent = "Escribe tu contraseña."; return; }
  formBusy(f, true); err.textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email, password });
  formBusy(f, false);
  if (error) err.textContent = authError(error);
});
$("#fSignup").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, err = f.querySelector(".err"), ok = f.querySelector(".okmsg");
  const name = $("#suName").value.trim(), email = $("#suEmail").value.trim(), password = $("#suPass").value;
  ok.textContent = "";
  if (!name) { err.textContent = "Escribe tu nombre o apodo."; return; }
  if (!validEmail(email)) { err.textContent = "Revisa el email."; return; }
  if (password.length < 8) { err.textContent = "La contraseña debe tener al menos 8 caracteres."; return; }
  formBusy(f, true); err.textContent = "";
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: APP_BASE } });
  formBusy(f, false);
  if (error) { err.textContent = authError(error); return; }
  if (!data.session) ok.textContent = `Listo. Te enviamos un correo a ${email}: abre el link para activar tu cuenta y luego entra.`;
});
$("#fForgot").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, err = f.querySelector(".err"), ok = f.querySelector(".okmsg");
  const email = $("#fgEmail").value.trim();
  if (!validEmail(email)) { err.textContent = "Escribe tu email."; return; }
  formBusy(f, true); err.textContent = ""; ok.textContent = "";
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: APP_BASE });
  formBusy(f, false);
  if (error) err.textContent = authError(error);
  else ok.textContent = "Si existe una cuenta con ese email, te llegará un correo en unos minutos. Revisa también spam.";
});
let recovering = false;
$("#fNewPass").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, err = f.querySelector(".err");
  const password = $("#npPass").value;
  if (password.length < 8) { err.textContent = "La contraseña debe tener al menos 8 caracteres."; return; }
  formBusy(f, true);
  const { error } = await sb.auth.updateUser({ password });
  formBusy(f, false);
  if (error) { err.textContent = authError(error); return; }
  recovering = false; toast("Contraseña actualizada");
  const { data } = await sb.auth.getSession(); if (data.session) signedIn(data.session);
});
$("#logout").addEventListener("click", async () => {
  if (sb) await sb.auth.signOut();
  me = null; loans = []; tokenCache.clear(); showForm("fLogin");
});

async function signedIn(session) {
  const u = session.user;
  if (me && me.id === u.id && !$("#appView").hidden) return;
  me = { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.name) || (u.email || "").split("@")[0] };
  $("#whoName").textContent = me.name;
  store = cloudStore(); show("appView"); setSide(side);
  try { await store.load(); } catch (e) { toast("No se pudieron cargar tus préstamos. Revisa tu conexión."); }
  await claimPending();
  maybeInstallHint();
}
async function claimPending() {
  const t = pendingClaim(); if (!t || !sb) return;
  try { localStorage.removeItem(CLAIM_KEY); } catch (e) { }
  const { data, error } = await sb.rpc("claim_confirmation", { p_token: t });
  if (error) { toast(/tuyo/.test(error.message || "") ? "Ese préstamo es tuyo: envíale el link a la otra persona." : "No se pudo guardar el préstamo del link. Ábrelo de nuevo."); return; }
  if (!data) { toast("Ese link ya no existe."); return; }
  try { await store.load(); } catch (e) { }
  setView("persona"); setSide("in");
  toast(data.added ? `Listo: ${data.added === 1 ? "la carta quedó" : data.added + " cartas quedaron"} en "Me prestaron"` : "Ese préstamo ya estaba en tu cuenta");
}

async function boot() {
  if (!CONFIGURED) {
    me = { id: "demo", name: "Modo demo" };
    $("#whoName").textContent = ""; $("#logout").hidden = true; $("#demoBanner").hidden = false;
    store = localStore(); show("appView"); setSide("out"); await store.load(); maybeInstallHint(); return;
  }
  if (!sb) { $("#fatalMsg").textContent = "No se pudo descargar una parte de la app. Revisa tu conexión y recarga la página."; show("fatalView"); return; }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { recovering = true; showForm("fNewPass"); return; }
    if (recovering) return;
    if (session) setTimeout(() => signedIn(session), 0);
    else if (event === "SIGNED_OUT") showForm("fLogin");
  });
  const { data } = await sb.auth.getSession();
  if (!data.session && !recovering) showForm("fLogin");
}

// Al volver a la app (p. ej. después de WhatsApp) se recargan los datos para ver confirmaciones nuevas
// y avisa lo que cambió desde la última vez (confirmaciones y devoluciones hechas desde un link)
async function refresh() {
  if (!(store && sb && me && !$("#appView").hidden)) return;
  const before = new Map(loans.map(l => [l.id, l]));
  try { await store.load(); } catch (e) { return; }
  const news = [];
  for (const l of loans) {
    const o = before.get(l.id); if (!o) continue;
    if (dirOf(l) === "in" && l.returnConfirmedAt && !o.returnConfirmedAt) news.push(`${l.person} confirmó que recibió ${l.card}`);
    else if (dirOf(l) === "out" && l.returnedAt && !o.returnedAt) news.push(`${l.card} quedó devuelta: ${l.person} te la regresó`);
    else if (dirOf(l) === "out" && l.confirmedAt && !o.confirmedAt) news.push(`${l.person} confirmó que tiene ${l.card}`);
  }
  if (news.length) toast(news[0] + (news.length > 1 ? ` y ${news.length - 1} más` : ""));
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
setInterval(() => { if (document.visibilityState === "visible" && !$("#form").contains(document.activeElement)) refresh(); }, 30000);

// ---------- Estado de la vista ----------
let side = "out", view = "persona", openPanel = null, retSel = new Set(), pqVal = {};
// openPanel: c:<id> confirmar | r:<id> recordar | p:<id> devolver | d:<id> borrar | g:<key> confirmar lote | R:<key> devolver lote
function setSide(sd) {
  side = sd; openPanel = null;
  $$(".side").forEach(b => b.setAttribute("aria-selected", b.dataset.side === sd));
  const t = TXT[sd];
  $("#formTitle").textContent = t.form; $("#personLabel").textContent = t.person; $("#dueLabel").textContent = t.due; $("#submitBtn").textContent = t.submit;
  render();
}
$$(".side").forEach(b => b.addEventListener("click", () => setSide(b.dataset.side)));
function setView(v) { view = v; $$(".tab").forEach(x => x.setAttribute("aria-selected", x.dataset.view === v)); }
$$(".tab").forEach(t => t.addEventListener("click", () => { setView(t.dataset.view); openPanel = null; render(); }));

// ---------- Formulario ----------
$("#due").value = addDays(7);
$$("#dueChips .chip-btn").forEach(b => b.addEventListener("click", () => {
  const n = Number(b.dataset.days);
  $$("#dueChips .chip-btn").forEach(x => x.setAttribute("aria-pressed", x === b));
  $("#due").value = n < 0 ? "" : addDays(n);
}));
$("#due").addEventListener("input", () => $$("#dueChips .chip-btn").forEach(x => x.setAttribute("aria-pressed", $("#due").value === "" && x.dataset.days === "-1")));
$("#person").addEventListener("change", () => {
  const n = norm($("#person").value); if (!n || $("#phone").value.trim()) return;
  const prev = [...loans].reverse().find(l => norm(l.person) === n && l.phone); if (prev) $("#phone").value = prev.phone;
});
const cardIn = $("#card"), acList = $("#acList"); let acItems = [], acOn = -1;
function acRender() {
  const q = norm(cardIn.value);
  if (!q) { acList.hidden = true; cardIn.setAttribute("aria-expanded", "false"); return; }
  acItems = (window.CATALOG || []).filter(c => norm(c.name).includes(q)).sort((a, b) => norm(a.name).indexOf(q) - norm(b.name).indexOf(q)).slice(0, 7);
  if (!acItems.length) { acList.hidden = true; return; }
  acList.innerHTML = acItems.map((c, i) => `<button type="button" role="option" class="ac-item${i === acOn ? " on" : ""}" data-i="${i}"><span>${esc(c.name)}</span><span class="mono">${c.set} · ${cop.format(c.value)}</span></button>`).join("");
  acList.hidden = false; cardIn.setAttribute("aria-expanded", "true");
}
function acPick(i) { const c = acItems[i]; if (!c) return; cardIn.value = c.name; $("#set").value = c.set; $("#value").value = c.value; acList.hidden = true; acOn = -1; $("#person").focus(); }
cardIn.addEventListener("input", () => { acOn = -1; acRender(); });
cardIn.addEventListener("keydown", e => {
  if (acList.hidden) return;
  if (e.key === "ArrowDown") { e.preventDefault(); acOn = Math.min(acOn + 1, acItems.length - 1); acRender(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); acOn = Math.max(acOn - 1, 0); acRender(); }
  else if (e.key === "Enter" && acOn >= 0) { e.preventDefault(); acPick(acOn); }
  else if (e.key === "Escape") { acList.hidden = true; }
});
acList.addEventListener("mousedown", e => { const b = e.target.closest(".ac-item"); if (b) { e.preventDefault(); acPick(Number(b.dataset.i)); } });
cardIn.addEventListener("blur", () => setTimeout(() => acList.hidden = true, 120));

$("#form").addEventListener("submit", async e => {
  e.preventDefault();
  const card = cardIn.value.trim(), person = $("#person").value.trim(), err = $("#formErr");
  if (!card) { err.textContent = "Escribe el nombre de la carta."; cardIn.focus(); return; }
  if (!person) { err.textContent = side === "out" ? "Escribe a quién se la prestas." : "Escribe quién te la presta."; $("#person").focus(); return; }
  if (!store) { err.textContent = "Todavía estoy cargando, intenta en un segundo."; return; }
  err.textContent = "";
  const data = {
    dir: side, card, set: $("#set").value.trim().toUpperCase(), person,
    qty: Math.max(1, Math.min(99, parseInt($("#qty").value) || 1)), value: Math.max(0, parseInt($("#value").value) || 0),
    foil: $("#foil").checked, phone: $("#phone").value.trim(), confirmedAt: "", due: $("#due").value || "", note: $("#note").value.trim(),
    createdAt: new Date().toISOString(), returnedAt: ""
  };
  const btn = $("#submitBtn"); btn.disabled = true;
  try {
    const nid = await store.add(data);
    const pend = loans.filter(l => dirOf(l) === side && norm(l.person) === norm(person) && !l.returnedAt && !l.confirmedAt).length;
    if (pend >= 2) { setView("persona"); openPanel = "g:" + keyOf(person); render(); toast(`Agregada. Tienes ${pend} cartas con ${person} para confirmar en un solo mensaje`); }
    else { openPanel = "c:" + nid; render(); toast(`Registrada. Puedes agregar otra carta con ${person} o enviar el mensaje`); }
    cardIn.value = ""; $("#set").value = ""; $("#value").value = ""; $("#qty").value = 1; $("#note").value = ""; $("#foil").checked = false; cardIn.focus();
  } catch (x) { err.textContent = "No se pudo guardar. Revisa tu conexión e intenta de nuevo."; }
  finally { btn.disabled = false; }
});

// ---------- Mensajes ----------
function waNumber(p) { let d = String(p || "").replace(/\D/g, ""); if (d.length === 10 && d[0] === "3") d = "57" + d; return d; }
function waLink(phone, msg) { return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(msg)}`; }
const cardStr = (l, q) => { q = q ?? l.qty; return `${q > 1 ? q + "x " : ""}${l.card}${l.set ? " (" + l.set + ")" : ""}${l.foil ? " foil" : ""}`; };
function confirmText(l, url) {
  const valor = l.value ? ` Valor de referencia: ${cop.format(val(l))}.` : "";
  const late = l.due && daysUntil(l.due) < 0;
  if (dirOf(l) === "out") {
    const fecha = l.due ? (late ? `Quedamos en que me la devolvías el ${fmtDate(l.due)}.` : `Quedamos en que me la devuelves el ${fmtDate(l.due)}.`) : "Me la devuelves cuando terminemos de usarla.";
    return `Hola ${l.person}! Te presté ${cardStr(l)} ${whenStr(l.createdAt)}.${valor} ${fecha}\n\n` + (url ? `¿Me confirmas que la tienes? Toca aquí, es un clic:\n${url}` : `¿Me confirmas que la tienes? Respóndeme OK 👍`);
  }
  const fecha = l.due ? (late ? `Quedamos en que te la devolvía el ${fmtDate(l.due)}, ya te la llevo.` : `Te la devuelvo el ${fmtDate(l.due)}.`) : "Te la devuelvo apenas termine de usarla.";
  return `Hola ${l.person}! Te confirmo que recibí tu ${cardStr(l)} ${whenStr(l.createdAt)}.${valor} ${fecha}\n\n¡Gracias! 🙌`;
}
function batchText(items, url) {
  const p = items[0].person, d = dirOf(items[0]), n = sum(items, l => l.qty), tot = sum(items, val);
  const lines = items.map(l => `• ${cardStr(l)}${l.value ? " · " + cop.format(val(l)) : ""}${l.due ? (d === "out" ? " · devolver el " : " · te la devuelvo el ") + fmtDate(l.due) : ""}`).join("\n");
  const totS = tot ? `\n\nValor de referencia total: ${cop.format(tot)}.` : "";
  return d === "out"
    ? `Hola ${p}! Te presté estas ${n} cartas:\n${lines}${totS}\n\n` + (url ? `¿Me confirmas que las tienes todas? Toca aquí, es un clic:\n${url}` : `¿Me confirmas que las tienes todas? Respóndeme OK 👍`)
    : `Hola ${p}! Te confirmo que recibí estas ${n} cartas tuyas:\n${lines}${totS}\n\n¡Gracias! Te aviso cuando te las devuelva 🙌`;
}
function returnText(items, qtys, url) {
  const p = items[0].person, d = dirOf(items[0]);
  const lines = items.map(l => `• ${cardStr(l, qtys && qtys[l.id])}`).join("\n");
  return d === "out" ? `Hola ${p}! Recibí de vuelta:\n${lines}\n\n¡Gracias! 🙌`
    : `Hola ${p}! Te devolví:\n${lines}\n\n` + (url ? `¿Me confirmas que las recibiste? Toca aquí:\n${url}` : `¿Me confirmas que las recibiste? 🙏`);
}
function reminderText(l) {
  const when = l.due ? (daysUntil(l.due) < 0 ? `Quedamos en que me la devolvías el ${fmtDate(l.due)}` : `Quedamos en que me la devuelves el ${fmtDate(l.due)}`) : "Cuando puedas me la devuelves";
  return `Hola ${l.person}! Te escribo por ${cardStr(l)} que te presté el ${shortDate(l.createdAt)}. ${when}. ¿Me avisas cuándo nos vemos? 🙌`;
}
// link: undefined = mensaje sin link | {state}
function msgBox(id, msg, phone, extra, link) {
  const loading = link && link.state === "loading";
  const dis = loading ? ` aria-disabled="true" tabindex="-1"` : "";
  return `<pre id="${id}">${loading ? "Generando el link de confirmación…" : esc(msg)}</pre><div class="actions">
  <a class="btn" data-wa href="${loading ? "#" : waLink(phone, msg)}" target="_blank" rel="noopener"${dis}>Enviar por WhatsApp${phone ? "" : " (eliges el chat)"}</a>
  <button class="btn" type="button" data-copy="${id}"${dis}>Copiar mensaje</button>${extra || ""}</div>`;
}

// ---------- Ejemplos ----------
async function loadExamples() {
  const now = new Date().toISOString();
  const ex = [
    ["out", "Rhystic Study", "PCY", "Camilo", 1, 140000, false, -5, "Para su mazo de Kinnan", ""],
    ["out", "Scalding Tarn", "MH2", "Camilo", 2, 80000, false, 10, "", ""],
    ["out", "Sheoldred, the Apocalypse", "DMU", "Laura", 1, 280000, true, 2, "Torneo Pioneer en la tienda", now],
    ["out", "Teferi's Protection", "CMM", "Laura", 1, 120000, false, 20, "", now],
    ["out", "Lightning Bolt", "2XM", "Juanse", 4, 6000, false, -12, "", now],
    ["in", "The One Ring", "LTR", "Sebas", 1, 180000, false, 3, "Para el Modern del sábado", now],
    ["in", "Orcish Bowmasters", "LTR", "Sebas", 2, 120000, false, 3, "", now],
    ["in", "Force of Will", "2XM", "Mafe", 1, 260000, false, -2, "", ""]
  ];
  try {
    for (const [dir, card, set, person, qty, value, foil, days, note, cf] of ex)
      await store.add({ dir, card, set, person, qty, value, foil, phone: "", confirmedAt: cf, due: days === null ? "" : addDays(days), note, createdAt: now, returnedAt: "", example: true });
    await store.add({ dir: "out", card: "Cyclonic Rift", set: "MM3", person: "Juanse", qty: 1, value: 120000, foil: false, phone: "", confirmedAt: now, due: addDays(-20), note: "", createdAt: now, returnedAt: now, example: true });
    toast("Ejemplos cargados");
  } catch (e) { toast("No se pudieron cargar los ejemplos."); }
}
$("#clearExamples").addEventListener("click", async () => {
  try { for (const l of loans.filter(l => l.example)) await store.remove(l.id); toast("Ejemplos quitados"); }
  catch (e) { toast("No se pudieron quitar todos los ejemplos. Intenta de nuevo."); }
});

// ---------- Render ----------
function groupBy(arr, key) { const m = new Map(); for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
const rank = l => ({ vencida: 0, pronto: 1, prestada: 2, devuelta: 3 })[status(l).k];
const sortLoans = a => a.sort((x, y) => (rank(x) - rank(y)) || (x.due || "9999").localeCompare(y.due || "9999"));

function loanRow(l, mode) {
  const t = TXT[dirOf(l)], s = status(l), id = l.id;
  const op = k => openPanel === k + ":" + id;
  const title = mode === "carta" ? esc(l.person) : esc(l.card) + (mode === "historial" ? ` <span class="muted">${t.who} ${esc(l.person)}</span>` : "");
  const quick = dirOf(l) === "out" && l.qty === 1;
  let panel = "";
  if (op("c") && !l.confirmedAt && !l.returnedAt) {
    const lk = dirOf(l) === "out" ? linkFor("loan", [id]) : undefined;
    panel = `<div class="remind"><span class="hint">${t.askHint}</span>${msgBox("m-" + id, confirmText(l, lk && lk.url), l.phone, `<button class="btn primary" data-act="confirmed">${t.askDone}</button><button class="btn ghost" data-act="close">Después</button>`, lk)}</div>`;
  } else if (op("r")) {
    panel = `<div class="remind">${msgBox("m-" + id, reminderText(l), l.phone, `<button class="btn ghost" data-act="close">Cerrar</button>`)}</div>`;
  } else if (op("p") && !l.returnedAt) {
    const n = Math.max(1, Math.min(l.qty, pqVal[id] || l.qty));
    const lk = dirOf(l) === "in" && n === l.qty ? linkFor("return", [id]) : undefined;
    panel = `<div class="remind">
      ${l.qty > 1 ? `<div class="qrow"><label for="pq-${id}">¿Cuántas copias?</label><input type="number" class="pq" id="pq-${id}" min="1" max="${l.qty}" value="${n}"><span class="muted">de ${l.qty}</span></div>` : ""}
      <span class="hint">${t.retHint}</span>
      ${msgBox("m-" + id, returnText([l], { [id]: n }, lk && lk.url), l.phone, `<button class="btn primary" data-act="return-yes">${n < l.qty ? `Marcar ${n} como ${plural(n, "devuelta", "devueltas")}` : "Marcar como devuelta"}</button><button class="btn ghost" data-act="close">Cancelar</button>`, lk)}</div>`;
  } else if (op("d")) {
    panel = `<div class="confirm"><span>¿Eliminar este registro? No se puede deshacer.</span><button class="btn danger" data-act="del-yes">Eliminar</button><button class="btn ghost" data-act="close">Cancelar</button></div>`;
  }
  let conf = "";
  if (!l.returnedAt) conf = l.confirmedAt ? `<span class="cf yes">${t.cfYes} ${shortDate(l.confirmedAt)}</span>` : `<span class="cf no">${t.cfNo}</span>`;
  else if (dirOf(l) === "in") conf = l.returnConfirmedAt ? `<span class="cf yes">${esc(l.person)} confirmó que la recibió</span>` : `<span class="cf no">Falta que confirme que la recibió</span>`;
  return `<div class="loan" data-id="${id}">
    <div class="thumb" aria-hidden="true">${esc(initials(l.card))}</div>
    <div class="loan-main">
      <span class="loan-title">${l.qty > 1 ? `<span class="mono">${l.qty}×</span> ` : ""}${title}</span>
      <div class="meta">
        <span class="pill s-${s.k}">${esc(l.returnedAt ? "Devuelta el " + shortDate(l.returnedAt) : s.label)}</span>
        ${l.set ? `<span class="mono">${esc(l.set)}</span>` : ""}
        ${l.foil ? `<span class="tag">Foil</span>` : ""}
        ${conf}
        ${l.example ? `<span class="tag">Ejemplo</span>` : ""}
      </div>
      ${l.note ? `<span class="note">${esc(l.note)}</span>` : ""}
    </div>
    <div class="loan-side">
      <span class="price">${l.value ? cop.format(val(l)) : "Sin valor"}</span>
      <div class="actions">
        ${l.returnedAt ? `<button class="btn" data-act="undo">Deshacer</button>`
      : `${!l.confirmedAt ? `<button class="btn" data-act="ask">${t.ask}</button>` : (dirOf(l) === "out" ? `<button class="btn" data-act="remind">Recordar</button>` : "")}<button class="btn primary" data-act="${quick ? "return-yes" : "return"}">${t.ret}</button>`}
        <button class="btn ghost" data-act="del" aria-label="Eliminar">✕</button>
      </div>
    </div>
    ${panel}
  </div>`;
}

function personGroup(items) {
  const t = TXT[side], key = keyOf(items[0].person), n = sum(items, l => l.qty), tot = sum(items, val);
  const pend = sortLoans(items.filter(l => !l.confirmedAt));
  const phone = ([...items].reverse().find(l => l.phone) || {}).phone;
  let panel = "";
  if (openPanel === "g:" + key && pend.length >= 2) {
    const lk = side === "out" ? linkFor("loan", pend.map(l => l.id)) : undefined;
    panel = `<div class="remind" style="margin:12px 16px 0"><span class="hint">${t.batchHint}</span>${msgBox("g-" + key, batchText(pend, lk && lk.url), phone, `<button class="btn primary" data-gact="confirmed">${t.askDone} (${pend.length})</button><button class="btn ghost" data-gact="close">Después</button>`, lk)}</div>`;
  }
  if (openPanel === "R:" + key) {
    const sel = items.filter(l => retSel.has(l.id));
    const lk = side === "in" && sel.length ? linkFor("return", sel.map(l => l.id)) : undefined;
    panel = `<div class="remind" style="margin:12px 16px 0"><span class="hint">${t.retHint}</span>
      <div class="retlist">${sortLoans([...items]).map(l => `<label><input type="checkbox" data-ret="${l.id}" ${retSel.has(l.id) ? "checked" : ""}> ${esc(cardStr(l))}</label>`).join("")}</div>
      ${sel.length ? msgBox("R-" + key, returnText(sel, null, lk && lk.url), phone, `<button class="btn primary" data-gact="return-yes">Marcar ${sel.length} como ${plural(sel.length, "devuelta", "devueltas")}</button><button class="btn ghost" data-gact="close">Cancelar</button>`, lk)
        : `<div class="actions"><span class="muted">Marca al menos una carta.</span><button class="btn ghost" data-gact="close">Cancelar</button></div>`}</div>`;
  }
  return `<div class="group" data-g="${esc(key)}"><div class="group-head"><h3>${esc(items[0].person)}</h3><span class="tot">${n} ${plural(n, "carta", "cartas")} · ${cop.format(tot)}</span>
    ${(pend.length >= 2 || items.length >= 2) ? `<div class="actions">
      ${pend.length >= 2 ? `<button class="btn" data-gact="ask">${t.batchAsk(pend.length)}</button>` : ""}
      ${items.length >= 2 ? `<button class="btn" data-gact="return">${t.retGroup}</button>` : ""}</div>` : ""}
    </div>${panel}${sortLoans([...items]).map(l => loanRow(l, "persona")).join("")}</div>`;
}

function sideSummary(dir) {
  const a = loans.filter(l => dirOf(l) === dir && !l.returnedAt);
  const n = sum(a, l => l.qty), p = new Set(a.map(l => norm(l.person))).size, over = a.filter(l => status(l).k === "vencida").length;
  const sub = !a.length ? (dir === "out" ? "Nada prestado" : "Nada por devolver")
    : `${n} ${plural(n, "carta", "cartas")} · ${p} ${plural(p, "persona", "personas")}${over ? ` · <b>${over} ${plural(over, "vencida", "vencidas")}</b>` : ""}`;
  return { v: cop.format(sum(a, val)), sub };
}

function render() {
  if ($("#appView").hidden) return;
  const o = sideSummary("out"), i = sideSummary("in");
  $("#vOut").textContent = o.v; $("#subOut").innerHTML = o.sub; $("#vIn").textContent = i.v; $("#subIn").innerHTML = i.sub;
  $("#people").innerHTML = [...new Set(loans.map(l => l.person))].sort().map(n => `<option value="${esc(n)}">`).join("");
  const mine = loans.filter(l => dirOf(l) === side), active = mine.filter(l => !l.returnedAt), done = mine.filter(l => l.returnedAt);
  $("#nP").textContent = new Set(active.map(l => norm(l.person))).size || "";
  $("#nC").textContent = new Set(active.map(l => norm(l.card))).size || "";
  $("#nH").textContent = done.length || "";
  $("#clearExamples").hidden = !loans.some(l => l.example);
  const list = $("#list"), t = TXT[side];
  if (!store) { list.innerHTML = `<div class="empty"><p class="muted">Cargando tus préstamos…</p></div>`; return; }
  if (!loans.length) {
    list.innerHTML = `<div class="empty"><h2>Aún no tienes préstamos registrados</h2>
      <p class="muted">Registra arriba las cartas que prestas y las que te prestan. Aquí verás quién tiene cada una, cuánto valen y cuáles ya se vencieron.</p>
      <button class="btn" id="loadEx" type="button">Ver con datos de ejemplo</button></div>`;
    $("#loadEx").addEventListener("click", loadExamples); return;
  }
  let html = "";
  if (view !== "historial" && !active.length) html = `<div class="empty"><h2>${t.emptyH}</h2><p class="muted">${t.emptyP}</p></div>`;
  if (view === "persona") {
    const groups = [...groupBy(active, l => norm(l.person)).values()].sort((a, b) => Math.min(...a.map(rank)) - Math.min(...b.map(rank)) || sum(b, val) - sum(a, val));
    html += groups.map(personGroup).join("");
  } else if (view === "carta") {
    const groups = [...groupBy(active, l => norm(l.card)).values()].sort((a, b) => a[0].card.localeCompare(b[0].card));
    for (const items of groups) {
      const n = sum(items, l => l.qty), p = new Set(items.map(l => norm(l.person))).size;
      html += `<div class="group"><div class="group-head"><h3>${esc(items[0].card)}</h3><span class="tot">${n} ${plural(n, "copia", "copias")} · ${p} ${plural(p, "persona", "personas")}</span></div>${sortLoans([...items]).map(l => loanRow(l, "carta")).join("")}</div>`;
    }
  } else {
    html = !done.length ? `<div class="empty"><p class="muted">Cuando marques un préstamo como devuelto aparecerá aquí.</p></div>`
      : `<div class="group">${[...done].sort((a, b) => b.returnedAt.localeCompare(a.returnedAt)).map(l => loanRow(l, "historial")).join("")}</div>`;
  }
  const focusId = document.activeElement && document.activeElement.id;
  list.innerHTML = html;
  if (focusId && focusId.startsWith("pq-")) { const f = document.getElementById(focusId); if (f) { f.focus(); const v = f.value; f.value = ""; f.value = v; } }
}

// ---------- Acciones ----------
async function returnLoan(l, n) {
  const now = new Date().toISOString();
  if (n >= l.qty) { await store.update(l.id, { returnedAt: now }); return; }
  const { id, ...rest } = l;
  await store.update(l.id, { qty: l.qty - n });
  await store.add({ ...rest, qty: n, returnedAt: now, returnConfirmedAt: "" });
}
$("#list").addEventListener("input", e => {
  const q = e.target.closest(".pq"); if (!q) return;
  const row = q.closest(".loan"), l = loans.find(x => x.id === row.dataset.id); if (!l) return;
  pqVal[l.id] = Math.max(1, Math.min(l.qty, parseInt(q.value) || 1));
  render();
});
$("#list").addEventListener("change", e => {
  const c = e.target.closest("[data-ret]"); if (!c) return;
  c.checked ? retSel.add(c.dataset.ret) : retSel.delete(c.dataset.ret); render();
});
$("#list").addEventListener("click", async e => {
  const off = e.target.closest('[aria-disabled="true"]'); if (off) { e.preventDefault(); return; }
  const cp = e.target.closest("[data-copy]"); if (cp) { copyFrom(document.getElementById(cp.dataset.copy)); return; }
  const gb = e.target.closest("[data-gact]");
  if (gb) {
    const key = gb.closest(".group").dataset.g, act = gb.dataset.gact;
    const items = loans.filter(l => dirOf(l) === side && keyOf(l.person) === key && !l.returnedAt);
    const pend = items.filter(l => !l.confirmedAt);
    try {
      if (act === "ask") { openPanel = openPanel === "g:" + key ? null : "g:" + key; render(); }
      else if (act === "return") { if (openPanel === "R:" + key) openPanel = null; else { openPanel = "R:" + key; retSel = new Set(items.map(l => l.id)); } render(); }
      else if (act === "close") { openPanel = null; render(); }
      else if (act === "confirmed") { openPanel = null; const now = new Date().toISOString(); for (const l of pend) await store.update(l.id, { confirmedAt: now }); render(); toast(side === "out" ? `${items[0].person} confirmó ${pend.length} préstamos` : `Listo, quedó registrado que le avisaste a ${items[0].person}`); }
      else if (act === "return-yes") { const sel = items.filter(l => retSel.has(l.id)); openPanel = null; for (const l of sel) await returnLoan(l, l.qty); render(); toast(`${sel.length} ${plural(sel.length, "carta devuelta", "cartas devueltas")}`); }
    } catch (x) { toast("No se pudo guardar el cambio. Intenta de nuevo."); }
    return;
  }
  const b = e.target.closest("[data-act]"); if (!b) return;
  const row = b.closest(".loan"), id = row.dataset.id, l = loans.find(x => x.id === id); if (!l) return;
  const act = b.dataset.act, tog = k => { openPanel = openPanel === k + ":" + id ? null : k + ":" + id; if (k === "p") delete pqVal[id]; render(); };
  try {
    if (act === "ask") tog("c");
    else if (act === "remind") tog("r");
    else if (act === "return") tog("p");
    else if (act === "del") tog("d");
    else if (act === "close") { openPanel = null; render(); }
    else if (act === "confirmed") { openPanel = null; await store.update(id, { confirmedAt: new Date().toISOString() }); render(); toast(dirOf(l) === "out" ? `${l.person} confirmó que tiene ${l.card}` : `Listo, quedó registrado que le avisaste a ${l.person}`); }
    else if (act === "return-yes") {
      const n = Math.max(1, Math.min(l.qty, pqVal[id] || l.qty));
      openPanel = null; delete pqVal[id]; await returnLoan(l, n); render();
      toast(dirOf(l) === "out" ? `${n > 1 ? n + " copias de " : ""}${l.card} ${plural(n, "vuelve", "vuelven")} a tu colección` : `Registrado: devolviste ${n > 1 ? n + " " : ""}${l.card} a ${l.person}`);
    }
    else if (act === "undo") { await store.update(id, { returnedAt: "" }); toast("Préstamo reabierto"); }
    else if (act === "del-yes") { openPanel = null; await store.remove(id); toast("Registro eliminado"); }
  } catch (x) { toast("No se pudo guardar el cambio. Intenta de nuevo."); }
});

// ---------- Instalar en el celular ----------
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; maybeInstallHint(); });
function maybeInstallHint() {
  let dismissed = false; try { dismissed = localStorage.getItem("qtmc-install-dismissed") === "1"; } catch (e) { }
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (dismissed || standalone || $("#appView").hidden) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (deferredPrompt) { $("#installText").textContent = "Instala la app en tu celular para tenerla a un toque."; $("#installBtn").hidden = false; $("#installBox").hidden = false; }
  else if (ios) { $("#installText").textContent = "Para instalarla: toca Compartir y luego \"Agregar a pantalla de inicio\"."; $("#installBtn").hidden = true; $("#installBox").hidden = false; }
}
$("#installBtn").addEventListener("click", async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => { }); deferredPrompt = null; $("#installBox").hidden = true; });
$("#installClose").addEventListener("click", () => { $("#installBox").hidden = true; try { localStorage.setItem("qtmc-install-dismissed", "1"); } catch (e) { } });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => { });

boot();
