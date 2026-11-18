/**
 * Spanish text for /es/. One entry per data-i18n key in www/index.html.
 *
 *   data-i18n="key"            -> replaces the element's inner HTML
 *   data-i18n-ph="key"         -> replaces the placeholder
 *   data-i18n-attr="attr:key"  -> replaces that attribute (e.g. aria-label)
 *
 * Head tags (title, description, Open Graph) use the "meta*" / "og*" keys.
 * After editing, run `npm run build` to regenerate www/es/index.html.
 */
module.exports = {
  // <head>
  metaTitle: "Tutor de matemáticas, física e ingeniería en Miami y Broward",
  metaDesc: "Tutorías de matemáticas, física e ingeniería para secundaria y universidad. En línea o en persona en Miami-Dade y Broward, en español o inglés.",
  ogDesc: "Tutorías de matemáticas, física e ingeniería para secundaria y universidad, en línea o en el sur de Florida. En español o en inglés.",
  jobTitle: "Tutor de matemáticas, física e ingeniería",

  // labels for assistive tech
  waLabel: "Escríbele a Jose por WhatsApp",
  navLabel: "Principal",
  langLabel: "Idioma",
  photoAlt: "Jose Diaz",

  skip: "Saltar al contenido",
  markSub: "Tutorías de matemáticas, física e ingeniería",
  navSubjects: "Materias", navHow: "Cómo funciona", navAbout: "Sobre mí", navRates: "Precios", navFaq: "Preguntas",
  ctaShort: "Agenda una llamada gratis",
  heroTitle: "Matemáticas y física, de la mano de un ingeniero que las usa todos los días.",
  heroLede: "Tutorías individuales y en grupos pequeños para estudiantes de secundaria y universidad. En línea desde cualquier lugar, o en persona en Broward y Miami-Dade, en español o en inglés.",
  ctaLong: "Agenda una llamada gratis de 20 minutos",
  ctaRates: "Ver precios",
  fact1: "<strong>Tutor desde 2016</strong>",
  fact2: "<strong>Más de 15 años</strong> como ingeniero",
  fact3: "<strong>Español e inglés</strong>",
  svgTitle: "Proyectil: halla el alcance R",
  svgGiven: "Datos: v₀ = 20 m/s, θ = 30°, g = 9.8 m/s²",
  svgNote: "← como en AP Physics 1",
  svgCap: "Un problema resuelto de tiro parabólico: lanzado a 20 m/s y 30 grados, recorre unos 35.3 metros.",

  // hero class picker: chips, course lines, and the five other worked problems
  pickLabel: "Elige tu materia:",
  tabPhysics: "Física", tabAlgebra: "Álgebra", tabGeometry: "Geometría y trigonometría",
  tabCalculus: "Cálculo", tabCircuits: "Circuitos", tabC: "C y microcontroladores",
  coursePhysics: "High school y universidad · Física, AP Physics 1 y C, Física I",
  courseAlgebra: "High school · Álgebra 2, Precálculo",
  courseGeometry: "High school · Geometría (EOC, honors), Precálculo y trigonometría, SAT",
  courseCalculus: "AP Calc BC · Cálculo II en la universidad",
  courseCircuits: "Ingeniería · Circuitos eléctricos I, Física II",
  courseC: "Ingeniería · Programación en C, Microcontroladores y sistemas embebidos",
  algTitle: "Interés: ¿cuándo llegan $2,000 a $5,000?",
  algGiven: "Datos: 6 % anual, compuesto mensualmente",
  algNote1: "← saco ln a ambos lados",
  algAns: "t ≈ 15.3 años",
  algNote: "← como en Álgebra 2 y Precálculo",
  algCap: "$2,000 invertidos al 6 % compuesto mensualmente llegan a $5,000 en unos 15.3 años.",
  geoTitle: "Dos ángulos: ¿qué altura tiene el edificio?",
  geoGiven: "Datos: 40°, y 58° tras acercarte 50 m",
  geoNote1: "← la misma h",
  geoNote: "Geometría honors y Precálculo →",
  geoCap: "Dos ángulos de elevación, 40° y 58°, medidos a 50 m de distancia dan una altura de unos 88.2 m.",
  calcTitle: "Volumen de un sólido de revolución",
  // √ is drawn (Kalam has no glyph): the <use> sits in the gap left by dx, positioned for this text's width
  calcGiven: '<text class="hand-g" x="54" y="64" font-size="17">Datos: y = <tspan dx="12">x, 0 ≤ x ≤ 4, gira alrededor del eje x</tspan></text><use class="rad" href="#rad" x="139.2" y="64"/>',
  calcNote1: "← discos",
  calcAns: "V = 8π ≈ 25.1 unidades³",
  calcNote: "como en AP Calc BC y Cálculo II",
  calcCap: "La región bajo y = raíz de x de 0 a 4, girada alrededor del eje x, tiene volumen 8 pi, unos 25.1.",
  rcTitle: "Circuito RC: voltaje después de 1 s",
  rcGiven: "Datos: 12 V, R = 10 kΩ, C = 100 µF, descargado",
  rcNote: "como en Circuitos I y Física II",
  rcCap: "Una fuente de 12 V que carga un capacitor de 100 microfaradios a través de 10 kiloohmios llega a unos 7.59 V en 1 segundo.",
  cTitle: "Enciende un LED sin tocar los demás",
  cGiven: "Datos: LED en el bit 5 de PORTB (pin 13 del Arduino Uno)",
  cStep: "el OR deja cada 1 y enciende el bit 5",
  cNote1: "← apaga los otros 7",
  cNote: "como en Programación en C y Microcontroladores",
  cCap: "Poner en 1 el bit 5 de PORTB con una máscara OR enciende un LED sin cambiar los otros siete pines.",
  m1: "Mi meta no es enseñarte.", m2: "Es que aprendas.", mSig: "Jose",
  subTitle: "Lo que enseño",
  subLede: "De secundaria a ingeniería universitaria, un mismo enfoque: entender por qué funciona el método y practicar hasta que salga solo.",
  hsTitle: 'Secundaria (<span lang="en">high school</span>)', hsLede: 'Grados 9 a 12, incluidos <span lang="en">honors</span>, AP y <span lang="en">dual enrollment</span>.',
  hs1: "Álgebra 1 y 2", hs1n: "incluye preparación para el EOC de Florida",
  hs2: "Geometría", hs2n: "incluye preparación para el EOC de Florida",
  hs3: "Precálculo y trigonometría", hs4: "AP Calculus AB y BC",
  hs5: "Física y AP Physics 1, 2, C", hs6: "Matemáticas del SAT y ACT",
  uTitle: "Universidad", uLede: "Matemáticas y física para carreras STEM, pre-medicina e ingeniería.",
  u1: "Álgebra universitaria y precálculo", u2: "Cálculo I, II y III", u3: "Ecuaciones diferenciales",
  u4: "Física I y II", u4n: "con álgebra o con cálculo",
  u5: "Repasos para parciales y finales", u5n: "individuales o en grupo",
  eTitle: "Cursos de ingeniería",
  eLede: "Para estudiantes de ingeniería eléctrica y de computación. Son los temas con los que trabajo a diario como ingeniero, así que vemos la teoría y cómo se usa en hardware real.",
  eNote: "¿No ves tu curso? Envíame el programa.",
  e1: "Circuitos eléctricos I y II", e1n: "DC, AC, transitorios", e2: "Diseño lógico digital",
  e3: "Programación", e3n: "C, C++, Python", e4: "Microcontroladores y sistemas embebidos",
  schTitle: "Tutorías para cursos en", schUM: "Universidad de Miami",
  schFIUc: "Florida International University, Miami", schFAUc: "Florida Atlantic University, Boca Raton",
  schNote: 'También estudiantes de <span lang="en">high school</span> en Broward y Miami-Dade, y en línea desde cualquier lugar.',
  howTitle: "Cómo funciona",
  s1t: "Llamada inicial gratis", s1p: "20 minutos para revisar el curso, el programa y en qué te atascas. Sin compromiso.",
  s2t: "Un plan según tus exámenes", s2p: "Organizo los temas según tus fechas de examen, para que cada sesión se enfoque en lo que viene.",
  s3t: "Lo que aprendes, se queda", s3p: "Resolvemos problemas juntos hasta que puedas hacerlos solo, y luego practicamos en condiciones de examen.",
  aiTitle: "¿Por qué un tutor si existe la IA?",
  aiLead1: "La IA te explica cualquier tema a las 2 de la mañana.", aiLead2: "Pero no puede hacer el examen por ti.",
  ai1t: "Encuentro el punto débil.", ai1p: "La IA responde lo que preguntas. Yo encuentro el paso que no sabes que te falta.",
  ai2t: "Practicas sin ella.", ai2p: "El día del examen no hay IA. Entrenamos para ese momento en que estás tú solo frente al problema.",
  ai3t: "Te enseño a usarla bien.", ai3p: "Cómo verificar sus respuestas, detectar sus errores y usarla para estudiar, no para saltarte el estudio.",
  aboutTitle: "Sobre mí",
  about1: "Soy Jose Diaz, ingeniero con más de 15 años diseñando electrónica y firmware para dispositivos médicos y sistemas aeroespaciales.",
  about2: "Estudié ingeniería en la Universidad Tecnológica de La Habana (CUJAE) y me gradué 5.º de un grupo que empezó con 150 estudiantes. Allí empecé a enseñar en segundo año como alumno ayudante de matemáticas y física. Doy tutorías en Estados Unidos desde 2016, desde middle school hasta la universidad.",
  about3: "Mi enfoque es sencillo: te muestro por qué funciona un método, no solo los pasos, para que siga teniendo sentido el día del examen. Y como uso estas matemáticas en mi trabajo, te puedo mostrar dónde aparecen de verdad.",
  c0: "<strong>CUJAE</strong>ingeniero graduado de la Universidad Tecnológica de La Habana. 5.º de 150.",
  c1: "<strong>Desde 2016</strong>dando tutorías en EE. UU.",
  c2: "<strong>Más de 15 años</strong>como ingeniero en la industria",
  liLink: "Ver mi experiencia en LinkedIn",
  revTitle: "Lo que dicen estudiantes y padres",
  ratesTitle: "Precios", ratesLede: "Las sesiones son de 60 minutos, en línea o en persona. La llamada inicial siempre es gratis.",
  r1t: "Secundaria, individual", r1p: "Sesiones semanales o preparación de exámenes cuando lo necesites.",
  perHour: "por hora",
  r2t: '<span lang="en">High school</span>, mensual', r2p: '<span data-price="plan.hs-monthly.sessions">8</span> sesiones al mes, los mismos días y horas cada semana.',
  r2s: '<span data-price="plan.hs-monthly.perHour">unos $54/hora</span>, ahorras <span data-price="plan.hs-monthly.save">$91</span>',
  r3t: "Universidad, individual", r3p: "Cálculo, ecuaciones diferenciales y física.",
  r4t: "Universidad, semestre", r4p: '<span data-price="plan.college-semester.sessions">12</span> sesiones individuales organizadas alrededor de tus parciales y tu final.',
  r4s: '<span data-price="plan.college-semester.perHour">unos $75/hora</span>, ahorras <span data-price="plan.college-semester.save">$181</span>',
  r5t: "Repaso en grupo para exámenes", r5p: "De 3 a 5 estudiantes del mismo curso, sesión de 2 horas antes de un parcial o final.", r5s: "por estudiante, por hora",
  r6t: "Cursos de ingeniería, individual", r6p: "Circuitos, lógica digital, programación y sistemas embebidos.",
  r7t: "Ingeniería, semestre", r7p: '<span data-price="plan.engineering-semester.sessions">12</span> sesiones individuales de tu curso de ingeniería, organizadas alrededor de tus parciales y tu final.',
  r7s: '<span data-price="plan.engineering-semester.perHour">unos $92/hora</span>, ahorras <span data-price="plan.engineering-semester.save">$221</span>',
  ratesAside: '¿Dos estudiantes juntos o algo a tu medida? <a href="#contact">Hablemos</a>.',
  guarantee: "<strong>Si tu primera sesión no vale la pena, no la pagas.</strong> Estudiantes nuevos, uno por familia. Avísame en las 24 horas siguientes.",
  pT: "Planes mensuales y semestrales", pP: "Pagas por adelantado, mantienes un horario fijo cada semana y ahorras.", pPrice: 'Ahorra alrededor de un <span data-price="badge">17%</span>', pMore: "Ver detalles",
  moreQ: "Tengo más preguntas",
  ratesNote: "Las sesiones en persona en Broward y Miami-Dade tienen el mismo precio. Los planes se pagan al inicio. Planes mensuales: las sesiones que no uses pasan al mes siguiente y luego vencen. Los planes semestrales son válidos durante el semestre en curso.",
  faqTitle: "Preguntas",
  q1: "¿Das tutorías en línea o en persona?", a1: "Ambas. Las sesiones en línea funcionan desde cualquier lugar con una laptop o tablet. Las presenciales son en Broward y Miami-Dade, en tu casa, una biblioteca o el campus.",
  q2: "¿Las sesiones son en español o en inglés?", a2: "En el idioma que te ayude a aprender. Muchos estudiantes mezclan ambos, y como los exámenes son en inglés, practicamos también el vocabulario.",
  q3: "¿Los padres pueden recibir reportes de progreso?", a3: "Sí. Para estudiantes de secundaria puedo enviar a los padres un resumen breve después de cada sesión: qué vimos y qué practicar.",
  q4: "¿Me haces la tarea o los trabajos evaluados?", a4: "No. Te ayudo a entender cómo resolver problemas parecidos para que hagas tú mismo los trabajos evaluados. Eso es también lo que te prepara para el examen.",
  q5: "¿Y si necesito cancelar?", a5: "Puedes reprogramar gratis con al menos 24 horas de aviso. Las sesiones canceladas con menos aviso se cobran completas.",
  q7: "¿Y si la primera sesión no te sirve?", a7: "Avísame en las 24 horas siguientes y te devuelvo el pago completo, sin tener que explicar por qué. Es para estudiantes nuevos, uno por familia. Si compraste un plan, te devuelvo el plan completo.",
  q6: "Mi examen es la semana que viene. ¿Es muy tarde?", a6: "No, pero reserva pronto. Las semanas de exámenes se llenan primero. Un repaso enfocado en los temas que van a evaluar todavía puede marcar una gran diferencia.",
  shareT1: "¿No es para ti?", shareT2: "Quizás sí para alguien que conoces.",
  shareP: "Un amigo con Cálculo II, un primo con el EOC encima, alguien de tu clase de Circuitos.",
  shareBtn: "Compártelo", shareWa: "Envíalo por WhatsApp", shareCopy: "Copiar enlace", shareCopied: "Enlace copiado",
  shareText: "Te paso este tutor de matemáticas, física e ingeniería en el sur de la Florida. Es ingeniero, enseña en inglés y en español, y la primera llamada de 20 minutos es gratis:",
  shareUrl: "https://josediaztutoring.com/es/?src=share",
  // no-JS WhatsApp link: "https://wa.me/?text=" + encodeURIComponent(shareText + " " + shareUrl)
  shareWaHref: "https://wa.me/?text=Te%20paso%20este%20tutor%20de%20matem%C3%A1ticas%2C%20f%C3%ADsica%20e%20ingenier%C3%ADa%20en%20el%20sur%20de%20la%20Florida.%20Es%20ingeniero%2C%20ense%C3%B1a%20en%20ingl%C3%A9s%20y%20en%20espa%C3%B1ol%2C%20y%20la%20primera%20llamada%20de%2020%20minutos%20es%20gratis%3A%20https%3A%2F%2Fjosediaztutoring.com%2Fes%2F%3Fsrc%3Dshare",
  contactTitle: "Agenda tu llamada gratis",
  contactLede: "Cuéntame el curso y en qué te atascas. Te respondo en un día hábil para coordinar una llamada de 20 minutos.",
  wa: "Escríbeme por WhatsApp",
  formPromise: "Intro gratis de 20 minutos. Y si tu primera sesión no vale la pena, no la pagas.",
  err: "Escribe tu nombre y tu correo para poder responderte.",
  fName: "Nombre", fEmail: "Correo electrónico", fPhone: "Teléfono", optional: "(opcional)", fLevel: "Nivel",
  oHs: "Secundaria (high school)", oU: "Universidad", oE: "Universidad, curso de ingeniería",
  fCourse: "Curso", phCourse: "p. ej., Calculus II en FIU",
  fMsg: "¿En qué necesitas ayuda?", phMsg: "Fechas de examen, temas difíciles, en línea o en persona…",
  send: "Enviar solicitud", sendNote: "Recibirás un correo de confirmación y te respondo en un día hábil.",
  foot: "Tutorías de matemáticas, física e ingeniería, en línea y en el sur de Florida.",
  footArea: "En persona en Broward y Miami-Dade · En línea desde cualquier lugar",
  footGbp: "Perfil en Google",
  footReview: "Déjame una reseña en Google",
  footContact: "Contacto",
  footPolicies: "Políticas", footPrivacy: "Privacidad", footTerms: "Términos", footA11y: "Accesibilidad",
  footFine: "Servicio independiente de tutorías. Sin afiliación con las instituciones mencionadas en este sitio.",
  required: "(obligatorio)",
  formNote: 'Al enviar este formulario, aceptas la <a href="/es/privacidad/">Política de privacidad</a>. Si el estudiante es menor de 18 años, lo debe enviar su padre, madre o tutor legal, o estar incluido.',

  // ===== Legal pages (pages/*.html -> /es/privacidad/, /es/terminos/, /es/accesibilidad/) =====
  // Approved text: change wording only together with the English page.
  crumbLabel: "Ruta de navegación", crumbHome: "Inicio",
  tocTitle: "En esta página",
  lastUpdated: "Última actualización:", lastReviewed: "Última revisión:",

  // --- Política de privacidad ---
  ppTitle: "Política de privacidad | Jose Diaz Tutoring",
  ppDesc: "Cómo Jose Diaz Tutoring recoge, usa y protege tu información, qué servicios la reciben y cómo puedes verla, corregirla o borrarla.",
  ppH1: "Política de privacidad",
  ppSummary: `
      <h2 id="summary-title">En resumen</h2>
      <ul>
        <li>Solo recojo lo que tú me envías y estadísticas básicas de las visitas al sitio.</li>
        <li>Lo uso para responderte y organizar tus sesiones. Nunca lo vendo ni lo uso para publicidad.</li>
        <li>Puedes pedirme en cualquier momento ver, corregir o borrar tu información: <a href="mailto:jose@josediaztutoring.com">jose@josediaztutoring.com</a>.</li>
      </ul>
    `,
  ppWho: `
      <h2>Quién soy</h2>
      <p>Jose Diaz Tutoring es un negocio de Jose Alexis Diaz, que trabaja por cuenta propia (<i lang="en">sole proprietor</i>) en Florida. En esta política, "yo" soy yo, el tutor.</p>
      <p>Esta política cubre josediaztutoring.com, su versión en español y la información que manejo cuando me contactas o tomas sesiones conmigo.</p>
    `,
  ppCollect: `
      <h2>Qué información recojo</h2>
      <table>
        <thead><tr><th scope="col">De dónde viene</th><th scope="col">Qué es</th></tr></thead>
        <tbody>
          <tr><td>El formulario de reserva</td><td>Tu nombre, correo, teléfono, el nivel del estudiante, la materia y en qué necesitas ayuda.</td></tr>
          <tr><td>Correo y WhatsApp</td><td>Lo que decidas enviarme.</td></tr>
          <tr><td>Si empiezas a tomar sesiones</td><td>Fechas de las sesiones, materias, notas de progreso y registros de pago (monto, fecha y método). No guardo números de tarjeta.</td></tr>
          <tr><td>Automáticamente, al visitar el sitio</td><td>Tu dirección IP, el tipo de navegador y de dispositivo, las páginas que visitas, desde qué página llegaste y qué botones del sitio usas. Mira <a href="#cookies-y-analitica">Cookies y analítica</a>.</td></tr>
        </tbody>
      </table>
    `,
  ppUse: `
      <h2>Para qué la uso</h2>
      <ul>
        <li>Para responder tu solicitud y coordinar tu llamada de introducción.</li>
        <li>Para programar y dar tus sesiones, y enviarte confirmaciones, recordatorios y cambios de horario.</li>
        <li>Para cobrar y llevar mis registros de impuestos.</li>
        <li>Para mantener el sitio seguro y bloquear el spam.</li>
        <li>Para ver, solo en números totales, qué páginas y botones son útiles, y así mejorar el sitio.</li>
      </ul>
      <p>No vendo tu información personal ni la uso para publicidad dirigida.</p>
    `,
  ppShare: `
      <h2>Con quién la comparto</h2>
      <p>Solo con los servicios que hacen funcionar mi negocio, y solo lo que cada uno necesita:</p>
      <table>
        <thead><tr><th scope="col">Proveedor</th><th scope="col">Para qué sirve</th><th scope="col">Qué recibe</th></tr></thead>
        <tbody>
          <tr><td>Google Cloud (App Engine)</td><td>Aloja el sitio</td><td>Datos técnicos de cada visita</td></tr>
          <tr><td>Google Analytics (mediante Google Tag Manager)</td><td>Cuenta las visitas</td><td>Un identificador de cookie, las páginas y los clics en botones, y una ubicación aproximada. Nunca tu nombre, correo ni teléfono.</td></tr>
          <tr><td>Google Fonts</td><td>Carga las fuentes del sitio</td><td>Tu dirección IP y tu tipo de navegador</td></tr>
          <tr><td>SMTP2GO</td><td>Entrega mis correos</td><td>Tu nombre, tu correo y el mensaje</td></tr>
          <tr><td>Amazon Web Services</td><td>Hace funcionar mi servidor de correo</td><td>Los correos que me envías</td></tr>
          <tr><td>WhatsApp (Meta)</td><td>Mensajería, solo si me escribes por ahí</td><td>Lo que envíes, según los términos de WhatsApp</td></tr>
        </tbody>
      </table>
      <p>También comparto información cuando la ley lo exige, por ejemplo ante una citación o una orden judicial. No comparto información personal con otras empresas para su propio marketing.</p>
    `,
  ppCookies: `
      <h2>Cookies y analítica</h2>
      <p>Uso Google Analytics, que se carga mediante Google Tag Manager, para contar las visitas y ver qué páginas y botones se usan.</p>
      <ul>
        <li>Crea dos cookies de este sitio. Duran hasta 2 años e identifican tu navegador, no a ti.</li>
        <li>Google usa tu dirección IP para estimar tu ubicación aproximada (la ciudad). Google Analytics no registra ni guarda direcciones IP.</li>
        <li>Google Signals y todas las funciones de publicidad están desactivadas. Nunca envío tu nombre, correo ni teléfono a Analytics.</li>
        <li>El sitio no usa otras cookies, píxeles de publicidad ni rastreadores de redes sociales.</li>
      </ul>
      <p><strong>Tus opciones:</strong> puedes bloquear o borrar las cookies en la configuración de tu navegador, o instalar el <a href="https://tools.google.com/dlpage/gaoptout" rel="noopener">complemento de Google para no ser medido por Analytics</a>. El sitio funciona igual en ambos casos. Para saber más, lee <a href="https://policies.google.com/technologies/partner-sites?hl=es" rel="noopener">cómo usa Google la información de los sitios que usan sus servicios</a>.</p>
      <h3>"No rastrear" (<span lang="en">Do Not Track</span>)</h3>
      <p>Analytics mide las visitas a lo largo del tiempo solo en este sitio. El sitio no te rastrea en otros sitios web ni te muestra anuncios, y no permito que otras empresas recojan información aquí para seguirte en otros sitios. Por eso, el sitio no responde de forma distinta a las señales de "No rastrear".</p>
    `,
  ppChildren: `
      <h2>Menores de edad</h2>
      <ul>
        <li>Mis servicios son para estudiantes de <i lang="en">high school</i>, estudiantes universitarios y sus padres. El sitio no está dirigido a niños menores de 13 años, y no recojo información de ellos a sabiendas.</li>
        <li>Si el estudiante es menor de 18 años, su padre, madre o tutor legal debe enviar el formulario o estar en copia.</li>
        <li>Si me entero de que recogí información de un niño menor de 13 años sin el consentimiento de sus padres, la borro.</li>
        <li>Las reglas sobre sesiones presenciales y grabaciones están en los <a href="/es/terminos/">Términos del servicio</a>.</li>
      </ul>
    `,
  ppAi: `
      <h2>Herramientas de IA</h2>
      <p>No pongo nombres ni datos de contacto de los estudiantes en herramientas de IA. Cuando uso IA para preparar material de práctica, quito todo lo que pueda identificar al estudiante.</p>
    `,
  ppKeep: `
      <h2>Cuánto tiempo la guardo</h2>
      <table>
        <thead><tr><th scope="col">Información</th><th scope="col">Tiempo</th></tr></thead>
        <tbody>
          <tr><td>Consultas que no terminan en sesiones</td><td>12 meses</td></tr>
          <tr><td>Notas de las sesiones</td><td>2 años después de la última sesión</td></tr>
          <tr><td>Registros de pagos e impuestos</td><td>7 años</td></tr>
          <tr><td>Datos de analítica</td><td>14 meses</td></tr>
          <tr><td>Registros del servidor</td><td>30 días</td></tr>
        </tbody>
      </table>
    `,
  ppProtect: `
      <h2>Cómo la protejo</h2>
      <p>Todas las páginas usan HTTPS (con HSTS). Solo yo tengo acceso a tu información, y elegí mis proveedores por su seguridad. Ningún sistema es perfectamente seguro; si alguna vez una filtración afecta tu información, te avisaré, como exige la ley.</p>
    `,
  ppRights: `
      <h2>Tus opciones y solicitudes</h2>
      <p>Escríbeme para:</p>
      <ul>
        <li>ver la información que tengo sobre ti;</li>
        <li>corregirla;</li>
        <li>borrarla (salvo los registros que debo guardar por impuestos);</li>
        <li>dejar de recibir mensajes que no tengan que ver con tus sesiones.</li>
      </ul>
      <p>Te respondo en un plazo de 30 días, y puede que antes te pida confirmar quién eres. Hacer una solicitud nunca cambia el precio ni la calidad de tus sesiones.</p>
    `,
  ppLinks: `
      <h2>Enlaces a otros sitios</h2>
      <p>Este sitio enlaza a WhatsApp, LinkedIn y Google. En sus sitios se aplican sus propias políticas de privacidad.</p>
    `,
  ppChanges: `
      <h2>Cambios en esta política</h2>
      <p>Cuando actualizo esta política, cambio la fecha de "Última actualización". Si el cambio es importante, como un nuevo tipo de información o un nuevo proveedor, también lo anuncio en la página principal durante 30 días.</p>
    `,
  ppLang: `
      <h2>Idioma</h2>
      <p>Esta política está en inglés y en español, y las dos versiones dicen lo mismo. Si alguna vez no coinciden, prevalece la versión en inglés.</p>
    `,
  ppContact: `
      <p><strong>Preguntas o solicitudes</strong></p>
      <p>Jose Alexis Diaz, Jose Diaz Tutoring</p>
      <p><a href="mailto:jose@josediaztutoring.com">jose@josediaztutoring.com</a></p>
    `,

  // --- Términos del servicio ---
  tosTitle: "Términos del servicio | Jose Diaz Tutoring",
  tosDesc: "Términos de las tutorías con Jose Diaz Tutoring: pagos, cancelación con 24 horas de aviso, reembolsos de planes, integridad académica y menores.",
  tosH1: "Términos del servicio",
  tosSummary: `
      <h2 id="summary-title">En resumen</h2>
      <ul>
        <li>Cancela o cambia tu sesión con al menos 24 horas de aviso, sin costo.</li>
        <li>Te ayudo a entender la materia. No hago trabajos que lleven nota.</li>
        <li>Las sesiones prepagadas que no hayas usado se pueden reembolsar.</li>
        <li>Estudiantes nuevos: si tu primera sesión no vale la pena, no la pagas.</li>
      </ul>
    `,
  tosAbout: `
      <h2>Sobre el servicio</h2>
      <p>Jose Diaz Tutoring ofrece tutorías individuales y en grupos pequeños de matemáticas, física e ingeniería: en línea desde cualquier lugar, y en persona en Broward y Miami-Dade, en inglés o en español. La llamada de introducción gratis de 20 minutos no te compromete a nada. Al reservar una sesión, aceptas estos términos.</p>
    `,
  tosIndependent: `
      <h2>Un servicio independiente</h2>
      <p>Jose Diaz Tutoring es un servicio de tutorías independiente. No tiene relación con ninguna escuela, <i lang="en">college</i> ni universidad mencionada en este sitio, ni cuenta con su aval; sus nombres se usan solo para describir los cursos en los que doy tutorías.</p>
      <p>AP y SAT son marcas registradas del College Board. ACT es una marca registrada de su titular. Ninguno de ellos tiene relación con este sitio ni lo avala.</p>
    `,
  tosRates: `
      <h2>Tarifas y pagos</h2>
      <ul>
        <li>Las tarifas actuales están en la página principal y pueden cambiar en cualquier momento. Se aplica la tarifa vigente cuando reservas o pagas.</li>
        <li>Las sesiones sueltas se pagan antes de la sesión. Los planes y los repasos grupales se pagan completos por adelantado.</li>
        <li>Acepto Zelle, tarjeta mediante un enlace de pago y efectivo en las sesiones presenciales.</li>
        <li>Un cambio de tarifas nunca afecta las sesiones ni los planes que ya pagaste.</li>
      </ul>
    `,
  tosCancel: `
      <h2>Cancelaciones y cambios de horario</h2>
      <ul>
        <li>Cancela o cambia tu sesión con al menos 24 horas de aviso, sin costo.</li>
        <li>Las cancelaciones con menos de 24 horas de aviso y las sesiones a las que no te conectes o no llegues se cobran completas.</li>
        <li>Si llegas tarde, la sesión termina a la hora prevista.</li>
        <li>Si soy yo quien cancela, tú eliges: cambiar la sesión de día o recibir el reembolso completo de esa sesión.</li>
      </ul>
    `,
  tosPlans: `
      <h2>Planes y reembolsos</h2>
      <p>Garantía de la primera sesión: si eres estudiante nuevo y tu primera sesión individual no valió la pena para ti, avísame en las 24 horas siguientes y te devuelvo el pago completo, sin necesidad de explicar por qué. Una por familia. Si compraste un plan, te devuelvo el plan completo.</p>
      <ul>
        <li>Planes mensuales: las sesiones que no uses pasan al mes siguiente y luego vencen. Los planes semestrales son válidos durante el semestre en curso.</li>
        <li>Puedes pedir el reembolso de las sesiones que no hayas usado en cualquier momento antes de que venza el plan. Las sesiones que ya usaste se cobran a la tarifa normal de sesión suelta vigente cuando compraste el plan, y te devuelvo el resto.</li>
        <li>Las sesiones que no uses antes de que venza el plan no se reembolsan.</li>
      </ul>
    `,
  tosGroup: `
      <h2>Repasos grupales para exámenes</h2>
      <ul>
        <li>Los repasos son en grupos pequeños y se pagan por adelantado.</li>
        <li>Si cancelas tu lugar con al menos 24 horas de aviso, te devuelvo el pago completo.</li>
        <li>Si 24 horas antes del repaso no hay suficientes estudiantes confirmados, lo cambio de fecha o le devuelvo el pago completo a todos.</li>
      </ul>
    `,
  tosIntegrity: `
      <h2>Integridad académica</h2>
      <p>Ayudo a los estudiantes a entender la materia y a aprender a resolverla por su cuenta. No:</p>
      <ul>
        <li>hago tareas, laboratorios ni proyectos que lleven nota;</li>
        <li>hago pruebas, exámenes ni <i lang="en">quizzes</i>, ni ayudo durante ellos;</li>
        <li>escribo nada que se vaya a entregar para una nota.</li>
      </ul>
      <p>Con gusto te ayudo a prepararte para todo eso, a revisar tu trabajo después de que lo califiquen y a practicar con problemas parecidos. Si me piden hacer trabajos con nota, puedo terminar el servicio; en ese caso, las sesiones prepagadas que no hayas usado se reembolsan como explico en <a href="#planes-y-reembolsos">Planes y reembolsos</a>.</p>
      <p>La IA es una herramienta que enseño a usar bien. Te explica cualquier tema a las 2 de la mañana. Pero no puede hacer el examen por ti.</p>
    `,
  tosGrades: `
      <h2>No garantizo notas</h2>
      <p>Llego a cada sesión preparado y doy lo mejor de mí. Pero las notas también dependen de la asistencia, la práctica y el propio curso, así que no puedo garantizar una nota ni un puntaje específico. Mi lema, "Mi meta no es enseñarte. Es que aprendas.", describe mi compromiso, no un resultado prometido.</p>
    `,
  tosMinors: `
      <h2>Estudiantes menores de 18 años</h2>
      <ul>
        <li>El padre, la madre o el tutor legal acepta estos términos en nombre del estudiante y se hace cargo del pago.</li>
        <li>En las sesiones presenciales, el padre, la madre, el tutor legal o un adulto de su confianza debe estar en casa durante la sesión, o nos vemos en un lugar público, como una biblioteca.</li>
        <li>Los padres pueden acompañar cualquier sesión en línea.</li>
      </ul>
    `,
  tosRecording: `
      <h2>Grabación de sesiones</h2>
      <p>Las sesiones no se graban. Solo grabo una sesión si todos los que participan están de acuerdo antes, y si el estudiante es menor de 18 años, también uno de sus padres. La ley de Florida exige el consentimiento de todos para grabar una conversación.</p>
    `,
  tosMessages: `
      <h2>Mensajes sobre tus sesiones</h2>
      <p>Al reservar, aceptas recibir mensajes sobre tus sesiones, como confirmaciones, recordatorios y cambios de horario, por correo o WhatsApp. Estos mensajes no son publicidad.</p>
    `,
  tosMaterials: `
      <h2>Materiales</h2>
      <p>Las hojas de ejercicios, las soluciones y los apuntes que te doy son para tu estudio personal. Por favor, no los revendas ni los publiques.</p>
    `,
  tosEnding: `
      <h2>Fin del servicio</h2>
      <p>Cualquiera de los dos puede terminar el servicio en cualquier momento. Las sesiones prepagadas que no hayas usado se reembolsan como explico en <a href="#planes-y-reembolsos">Planes y reembolsos</a>.</p>
    `,
  tosLiability: `
      <h2>Límite de responsabilidad</h2>
      <p>Las tutorías son un apoyo educativo. En la medida en que la ley lo permita, mi responsabilidad total por cualquier reclamo sobre mis servicios se limita a lo que pagaste por las sesiones en cuestión. No garantizo resultados académicos específicos.</p>
    `,
  tosDisputes: `
      <h2>Desacuerdos y ley aplicable</h2>
      <p>Si algo sale mal, escríbeme primero y buscamos una solución directamente. Estos términos se rigen por las leyes de Florida.</p>
    `,
  tosChanges: `
      <h2>Cambios e idioma</h2>
      <p>Puedo actualizar estos términos; la fecha de "Última actualización" indica cuándo. Los cambios no afectan las sesiones que ya pagaste. Estos términos están en inglés y en español; si alguna vez no coinciden, prevalece la versión en inglés.</p>
    `,
  tosContact: `
      <p><strong>Preguntas sobre estos términos</strong></p>
      <p><a href="mailto:jose@josediaztutoring.com">jose@josediaztutoring.com</a></p>
    `,

  // --- Declaración de accesibilidad ---
  accTitle: "Declaración de accesibilidad | Jose Diaz Tutoring",
  accDesc: "Cómo josediaztutoring.com busca cumplir las WCAG 2.2, nivel AA: lo que he hecho, las limitaciones conocidas y cómo pedir ayuda.",
  accCrumb: "Accesibilidad",
  accH1: "Declaración de accesibilidad",
  accLead: "Quiero que todo el mundo pueda usar este sitio, incluidas las personas que usan un lector de pantalla, el teclado, un magnificador u otra tecnología de apoyo.",
  accGoal: `
      <h2>Mi objetivo</h2>
      <p>Este sitio busca cumplir las Pautas de Accesibilidad para el Contenido Web (WCAG) 2.2, nivel AA. Lo reviso con herramientas automáticas y a mano, y corrijo los problemas a medida que los encuentro.</p>
    `,
  accDone: `
      <h2>Lo que he hecho</h2>
      <ul>
        <li>Títulos y estructura claros en inglés y en español, cada página marcada con su idioma.</li>
        <li>Navegación completa con el teclado, con un contorno de foco visible y un enlace para "Saltar al contenido".</li>
        <li>Descripciones de texto para las imágenes, incluido el problema de física resuelto al inicio de la página principal.</li>
        <li>Contraste de colores que cumple el nivel AA.</li>
        <li>Una animación que se detiene si tu dispositivo está configurado para reducir el movimiento.</li>
        <li>Texto que se puede ampliar al 200 % sin que se rompa el diseño.</li>
        <li>Botones y enlaces lo bastante grandes para tocarlos con el dedo.</li>
        <li>Campos del formulario con etiquetas visibles y mensajes de error que explican cómo corregir el problema.</li>
      </ul>
    `,
  accLimits: `
      <h2>Limitaciones conocidas</h2>
      <ul>
        <li>Las páginas de otras empresas, como WhatsApp, LinkedIn y Google, no dependen de mí.</li>
      </ul>
    `,
  accHelp: `
      <h2>¿Necesitas ayuda?</h2>
      <p>Si alguna parte del sitio no te funciona, o necesitas el contenido en otro formato, escríbeme. Dime en qué página y qué pasó, y te respondo en un plazo de 2 días hábiles.</p>
    `,
  accContact: `
      <p><a href="mailto:jose@josediaztutoring.com">jose@josediaztutoring.com</a></p>
      <p><a href="tel:+17868329107">786-832-9107</a> (llamada o WhatsApp)</p>
    `,
};
