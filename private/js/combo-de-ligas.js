/*
 * Un desplegable escribible de ligas, para las dos pantallas que lo necesitan.
 *
 * ============================================================================
 * ⛔ POR QUÉ ESTÁ AQUÍ Y NO COPIADO EN LAS DOS
 * ============================================================================
 *
 * Lo usan «Cómo se arman las jornadas» —elige UNA liga— y «Ligas favoritas»
 * —añade VARIAS—. Son doscientas líneas de teclado, filtrado, agrupación y
 * cierre al pinchar fuera. Copiadas dos veces, se separan: se arregla un
 * detalle en una pantalla y la otra se queda con el fallo, sin que nada avise.
 *
 * Las diferencias entre los dos usos son sólo tres, y por eso son parámetros:
 * de dónde salen las ligas, qué pasa al elegir una, y cuáles no hay que
 * ofrecer.
 *
 * ⚠️ NO es un control nativo, y no puede serlo: `<select>` no deja escribir y
 * `<datalist>` no deja agrupar, ni deshabilitar una opción con su motivo, ni
 * enseñar el país al lado. Por eso lleva los atributos ARIA a mano: sin ellos,
 * para un lector de pantalla esto es una caja de texto cualquiera.
 */
(function () {
  'use strict';

  /**
   * Sin tildes, sin mayúsculas y sin espacios de sobra.
   *
   * ⚠️ Es la misma normalización que hace `ligas.normalizarTexto` en el
   * servidor, escrita otra vez porque aquél no viaja al navegador. Sin esto,
   * «mexico» no encontraría «México» — y nadie escribe la tilde al buscar.
   */
  const normalizar = texto => String(texto || '')
    .normalize('NFD')
    /*
     * ⚠️ `\p{Diacritic}` y NO el rango `[̀-ͯ]`, que es lo mismo.
     * Escrito como rango, el archivo acaba guardando esos dos caracteres DE
     * VERDAD —son marcas combinantes, invisibles— y quien abra esta línea no ve
     * nada entre los corchetes. Funciona igual y no se puede leer.
     */
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

  /**
   * ⛔ LAS FAVORITAS VIENEN APARTE, Y OLVIDARLO LAS BORRA DE LA PANTALLA.
   *
   * `aplicarFavoritas` las SACA de `paises` y las devuelve en su propio
   * arreglo. La primera versión de esto leía sólo `paises`, así que las ocho
   * ligas que Marco tiene marcadas —Liga MX, Primera División, Champions…— no
   * aparecían en el selector. Ni al abrir ni al buscar.
   */
  function aplanar(datos) {
    const favoritas = (datos.favoritas || []).map(liga => ({
      liga, pais: liga.pais || '', favorita: true
    }));

    const resto = (datos.paises || [])
      .flatMap(pais => (pais.ligas || []).map(liga => ({ liga, pais: pais.pais, favorita: false })));

    return [...favoritas, ...resto];
  }

  /**
   * ¿Se puede elegir esta entrada, y si no, por qué?
   *
   * ⚠️ Una favorita que esta semana no juega llega SIN `automatizable`: la arma
   * `aplicarFavoritas` a partir de lo guardado, no de un partido real. Sin este
   * caso diría «no publica el número de jornada», que es mentira — lo que pasa
   * es que no juega.
   */
  function estadoPorDefecto({ liga }) {
    if (!liga.partidos) return { elegible: false, motivo: 'No juega esta semana.' };
    if (liga.automatizable === false) {
      return { elegible: false, motivo: liga.motivo || 'No se puede armar sola.' };
    }
    return { elegible: true, motivo: null };
  }

  /**
   * Engancha un desplegable escribible.
   *
   * `estadoDe` se puede sustituir: en las favoritas cualquier liga vale —se
   * marca para que salga primero, juegue o no— mientras que para armar jornadas
   * sólo sirven las que el proveedor sabe agrupar por ronda.
   */
  window.comboDeLigas = function comboDeLigas({
    caja, entrada, lista, resumen,
    cargar, alElegir,
    estadoDe = estadoPorDefecto,
    excluir = () => new Set(),
    textoResumen = n => `${n} disponibles.`
  }) {
    let todas = [];
    let visibles = [];
    let resaltada = -1;

    const encaja = (x, buscado) => !buscado
      /*
       * ⚠️ Por PAÍS y por COMPETICIÓN a la vez. Sólo por país obligaría a saber
       * de dónde es cada torneo — y los internacionales no son de ninguno.
       */
      || normalizar(x.pais).includes(buscado)
      || normalizar(x.liga.nombre).includes(buscado);

    function cerrar() {
      /*
       * ⛔ EL RECUENTO SE BORRA AL CERRAR.
       *
       * Dejado puesto, la pantalla se queda diciendo «253 se pueden armar solas»
       * sin ninguna lista debajo. Y eso se lee como «dice que hay 253 y no me
       * enseña ninguna» — que es exactamente la queja que llegó. El renglón
       * describe una lista abierta; cerrada, miente.
       */
      if (resumen) resumen.textContent = '';
      lista.hidden = true;
      entrada.setAttribute('aria-expanded', 'false');
      resaltada = -1;
    }

    function resaltar(i) {
      const opciones = [...lista.querySelectorAll('li[data-indice]')];
      opciones.forEach(o => o.classList.remove('resaltada'));

      resaltada = Math.max(0, Math.min(i, visibles.length - 1));

      const elegida = opciones.find(o => Number(o.dataset.indice) === resaltada);
      if (elegida) {
        elegida.classList.add('resaltada');
        elegida.scrollIntoView({ block: 'nearest' });
      }
    }

    function encabezado(texto) {
      const li = document.createElement('li');
      li.className = 'combo-grupo';
      li.setAttribute('role', 'presentation');
      li.textContent = texto;
      return li;
    }

    function opcionDe(x, indice) {
      const { elegible, motivo } = estadoDe(x);

      const li = document.createElement('li');
      li.setAttribute('role', 'option');

      const nombre = document.createElement('span');
      nombre.textContent = x.liga.nombre;
      li.appendChild(nombre);

      if (!elegible) {
        /*
         * ⚠️ Se enseña, no se esconde. Quien busca la MLS y no la encuentra
         * piensa que la aplicación no la conoce y se queda intentándolo; verla
         * con su motivo cierra la pregunta de una vez.
         */
        li.setAttribute('aria-disabled', 'true');

        const porque = document.createElement('span');
        porque.className = 'combo-motivo';
        porque.textContent = motivo;
        li.appendChild(porque);
        return li;
      }

      /* Sólo las elegibles llevan índice: el teclado no se para en las demás. */
      li.dataset.indice = String(indice);

      const pais = document.createElement('span');
      pais.className = 'combo-pais';
      pais.textContent = x.pais || 'Internacional';
      li.appendChild(pais);

      li.addEventListener('mousedown', evento => {
        /* `mousedown` y no `click`: cerrar al perder el foco llegaría antes. */
        evento.preventDefault();
        elegir(x.liga);
      });

      return li;
    }

    function abrir() {
      const buscado = normalizar(entrada.value);
      const fuera = excluir();

      const encajan = todas.filter(x => !fuera.has(String(x.liga.id)) && encaja(x, buscado));

      /*
       * ⭐ Las elegibles primero, y dentro de ellas las favoritas. Lo que se usa
       * cada semana tiene que estar arriba; lo que no se puede elegir sigue ahí,
       * al final, para quien vino buscándolo justamente a ello.
       */
      const favoritas = encajan.filter(x => x.favorita && estadoDe(x).elegible);
      const demas = encajan.filter(x => !x.favorita && estadoDe(x).elegible);
      const noElegibles = encajan.filter(x => !estadoDe(x).elegible);

      /*
       * ⛔ UNA sola lista ordenada, y de ella salen las dos cosas: lo que se
       * pinta y por dónde se mueve el teclado. Construidas aparte, podían
       * discrepar — resaltabas una liga y Enter elegía otra.
       */
      visibles = [...favoritas, ...demas];
      lista.innerHTML = '';

      let ultimoGrupo = null;

      visibles.forEach((x, i) => {
        const grupo = x.favorita ? 'Tus favoritas' : (x.pais || 'Internacional');
        if (grupo !== ultimoGrupo) {
          lista.appendChild(encabezado(grupo));
          ultimoGrupo = grupo;
        }
        lista.appendChild(opcionDe(x, i));
      });

      if (noElegibles.length) {
        lista.appendChild(encabezado('No se pueden armar solas'));
        for (const x of noElegibles) lista.appendChild(opcionDe(x, -1));
      }

      if (!encajan.length) {
        lista.appendChild(encabezado(
          buscado ? `Nada coincide con «${entrada.value}»` : 'No queda ninguna por elegir'));
      }

      if (resumen) resumen.textContent = visibles.length ? textoResumen(visibles.length) : '';

      lista.hidden = false;
      entrada.setAttribute('aria-expanded', 'true');
      resaltar(0);
    }

    function elegir(liga) {
      cerrar();
      alElegir(liga);
    }

    /*
     * ⚠️ La petición en vuelo, para no lanzar dos.
     *
     * Un click de verdad dispara «focus» Y «click», y los dos abren. Sin este
     * cerrojo eran DOS viajes al proveedor cada vez que se toca la caja — y la
     * cuota del proveedor es compartida entre todas las quinielas.
     */
    let enVuelo = null;

    /** Trae las ligas una vez y abre. Las siguientes veces abre sin pedir nada. */
    async function abrirConLigas() {
      if (todas.length) { abrir(); return; }
      if (enVuelo) return;

      try {
        enVuelo = cargar();
        todas = aplanar(await enVuelo);
        abrir();
      } catch (error) {
        /* Quien llama decide qué decir: aquí no se sabe de qué pantalla es. */
        cerrar();
      } finally {
        /*
         * ⛔ Se suelta TAMBIÉN si falló. Guardada la promesa rota, la caja
         * quedaría muerta para siempre: ni al pinchar ni al escribir volvería a
         * intentarlo, y no habría manera de recuperarse sin recargar la página.
         */
        enVuelo = null;
      }
    }

    entrada.addEventListener('focus', abrirConLigas);
    entrada.addEventListener('click', abrirConLigas);

    /*
     * Filtra sobre lo que ya está en memoria: cada consulta al proveedor es
     * cuota compartida entre TODAS las quinielas, y «Costa Rica» son once
     * letras.
     */
    entrada.addEventListener('input', () => {
      /*
       * ⛔ Si todavía NO han llegado, se piden aquí también. Antes, escribir
       * antes de que cargaran no hacía nada y no decía nada: tecleabas y la caja
       * se quedaba muda hasta que se te ocurriera volver a pinchar.
       */
      if (todas.length) abrir();
      else abrirConLigas();
    });

    entrada.addEventListener('keydown', evento => {
      if (evento.key === 'Escape') { cerrar(); return; }

      if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
        evento.preventDefault();
        if (lista.hidden) { abrirConLigas(); return; }
        resaltar(resaltada + (evento.key === 'ArrowDown' ? 1 : -1));
        return;
      }

      if (evento.key === 'Enter' && !lista.hidden) {
        evento.preventDefault();
        const elegida = visibles[resaltada];
        if (elegida) elegir(elegida.liga);
      }
    });

    /*
     * ⚠️ Se cierra al pinchar fuera mirando si el click cayó DENTRO de la caja.
     * Con `blur` a secas se cerraba antes de que el click llegara a la opción.
     */
    document.addEventListener('mousedown', evento => {
      if (!caja.contains(evento.target)) cerrar();
    });

    return {
      cerrar,
      /** Vuelve a pintar sin pedir nada: para cuando cambia lo que se excluye. */
      refrescar: () => { if (!lista.hidden) abrir(); },
      /** Olvida lo traído, para volver a pedirlo la próxima vez. */
      olvidar: () => { todas = []; }
    };
  };
})();
