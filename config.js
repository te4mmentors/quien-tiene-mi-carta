// Configuración de Supabase.
// Reemplaza los dos valores con los de tu proyecto:
// Supabase > Project Settings > API (o "Connect") > Project URL y la clave "anon public" / "publishable".
// Esta clave es pública por diseño: la seguridad la dan las reglas del archivo supabase/schema.sql.
// Mientras no la cambies, la app funciona en "modo demo" y guarda todo solo en este navegador.
window.QTMC_CONFIG = {
  SUPABASE_URL: "https://pvpkinqfsldizuzvfvpv.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_qa3CMtCyXvYQfDhwQlnaag_yG4YkGoj",
  // Pesos colombianos por dólar para convertir los precios de Scryfall (TRM 22 oct 2026: 3.191). Ajústalo cuando quieras.
  COP_PER_USD: 3200
};
