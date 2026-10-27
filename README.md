# ¿Quién tiene mi carta?

App web para llevar el registro de las cartas de Magic que prestas y las que te prestan.
Funciona en el navegador del computador y del celular, y se puede **instalar en el celular** como una app.

- Cuentas con email y contraseña (Supabase Auth).
- **Presté / Me prestaron**, por persona o por carta, valor total en COP, vencidas.
- Confirmación por WhatsApp con **link de un clic, sin que el otro necesite cuenta**.
- Confirmar, devolver y avisar **por lote**, y devoluciones parciales (2 de 4 copias).

Son páginas estáticas (HTML, CSS y JS), sin paso de compilación. Los datos viven en Supabase.

```
index.html            App (login + préstamos)
c.html                Página pública del link de confirmación
config.js             ← aquí van la URL y la clave pública de Supabase
assets/app.js         Lógica de la app
assets/confirm.js     Lógica del link de confirmación
assets/catalog.js     Cartas del buscador con valor de referencia
assets/styles.css     Estilos
supabase/schema.sql   Tablas, reglas de seguridad y funciones
manifest.webmanifest, sw.js, icons/   Para instalarla en el celular
```

Mientras `config.js` tenga los valores de ejemplo, la app abre en **modo demo**: guarda todo solo en ese navegador y los mensajes no llevan link.

---

## Publicarla (unos 20 minutos)

### 1. Supabase: base de datos y usuarios

1. Entra a <https://supabase.com>, crea una cuenta y un **New project**. Región sugerida: *East US (North Virginia)* o *South America (São Paulo)*. Guarda la contraseña de la base de datos.
2. Ve a **SQL Editor → New query**, pega todo el contenido de `supabase/schema.sql` y pulsa **Run**. Debe decir *Success*.
3. Ve a **Project Settings → API** (o el botón **Connect**) y copia:
   - **Project URL** (algo como `https://abcd1234.supabase.co`)
   - La clave **anon public** (o **publishable**). Es pública por diseño; nunca uses la `service_role` / `secret`.
4. Pega esos dos valores en `config.js`.

### 2. GitHub: guardar el código

Sube esta carpeta a un repositorio (por ejemplo `quien-tiene-mi-carta`). Si conectas tu GitHub a la sesión con Claude, lo hace por ti.

### 3. Vercel: publicarla en internet

1. Entra a <https://vercel.com> con tu cuenta de GitHub.
2. **Add New → Project**, elige el repositorio y pulsa **Deploy**. No hay que cambiar nada (Framework: *Other*).
3. Te da un link tipo `https://quien-tiene-mi-carta.vercel.app`.

(También funciona igual en Netlify o Cloudflare Pages: es una carpeta estática.)

### 4. Supabase: decirle cuál es tu link

En **Authentication → URL Configuration**:
- **Site URL**: tu link de Vercel, por ejemplo `https://quien-tiene-mi-carta.vercel.app/`
- **Redirect URLs**: agrega el mismo link.

Así los correos de "confirma tu cuenta" y "recuperar contraseña" llevan a tu app.

### 5. Correos (importante)

El servicio de correo que trae Supabase es solo para pruebas: **solo envía a los miembros de tu equipo en Supabase y máximo 2 correos por hora**. Entonces:

- **Para probar con amigos ya:** en **Authentication → Sign In / Providers → Email**, desactiva **Confirm email**. La gente crea su cuenta y entra de una vez, sin correo.
- **Antes de abrirla al público:** configura un SMTP propio en **Authentication → Emails → SMTP Settings**, por ejemplo con Resend o Brevo (tienen plan gratis). Sin eso, "Olvidé mi contraseña" no le llega a usuarios normales.

---

## Instalar en el celular

- **Android (Chrome):** la app muestra un botón **Instalar app**, o menú ⋮ → *Agregar a pantalla principal*.
- **iPhone (Safari):** botón Compartir → *Agregar a pantalla de inicio*.

## Cómo funciona el link de confirmación

1. Registras que le prestaste cartas a Camilo y pulsas **Enviar por WhatsApp**.
2. El mensaje lleva un link `…/c.html?t=…`. Camilo lo abre, sin cuenta, y ve las cartas, el valor y la fecha.
3. Pulsa **Sí, las tengo** y en tu app aparece "Confirmó el 27 oct". Se actualiza al volver a la app.

Lo mismo al revés: cuando devuelves cartas que te prestaron, el dueño confirma en el link que las recibió.

El link solo muestra cartas, cantidades, valor, fecha y tu nombre; nunca teléfonos ni notas. Cada usuario solo puede ver y modificar sus propios préstamos (reglas RLS en `schema.sql`).

## Cambiar algo

- **Cartas del buscador:** `assets/catalog.js` (nombre, edición, valor en COP).
- **Textos de los mensajes:** funciones `confirmText`, `batchText`, `returnText` y `reminderText` en `assets/app.js`.
- Tras publicar cambios, sube el número de `CACHE` en `sw.js` (`qtmc-v1` → `qtmc-v2`) para que los celulares tomen la versión nueva.
