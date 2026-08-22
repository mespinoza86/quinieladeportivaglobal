/*
 * Cómo se lee la respuesta del proveedor.
 *
 * Todo lo de aquí es **puro**: recibe el JSON crudo de APIFootball y devuelve
 * un dato. No consulta la base, no conoce Express y no depende del reloj.
 *
 * ============================================================================
 * POR QUÉ ES UN MÓDULO Y NO ESTABA SUELTO
 * ============================================================================
 *
 * Es la **frontera** con el proveedor, y las fronteras conviene tenerlas en un
 * sitio: el JSON de APIFootball tiene rarezas que no se adivinan —da local y
 * visitante al revés según el endpoint, marca los goles anulados dentro de un
 * texto libre, y el "minuto" a veces es un número y a veces "45+"—. Cada una
 * de esas rarezas está resuelta abajo con su comentario, y quien las cambie
 * debería poder ver todas a la vez.
 *
 * Y hay una razón práctica: `src/trivias.js` recibe el intérprete como
 * argumento (Entrada 045). Que viva aquí es lo que permite que la resolución
 * de trivias se pruebe con eventos escritos a mano, sin red y sin cuota.
 *
 * ⚠️ **Lo que NO está aquí es hablar con el proveedor.** Pedirle datos —con su
 * plazo de espera, su clave y su cuota— es `src/proveedor.js`. La separación
 * es la que permite probar todo esto sin salir a internet.
 */
'use strict';

function obtenerNumeroSeguro(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const numero = Number(valor);
  return Number.isNaN(numero) ? '' : numero;
}

function obtenerMarcador90Minutos(fixture, estadoPartido = null) {
  const estado = estadoPartido?.estado || '';

  // Mientras el partido está en vivo o en medio tiempo,
  // usamos el marcador vivo directo del API.
  if (estado === 'LIVE' || estado === 'MT') {
    return {
      marcador1: obtenerNumeroSeguro(fixture.match_hometeam_score),
      marcador2: obtenerNumeroSeguro(fixture.match_awayteam_score)
    };
  }

  const ftHome = obtenerNumeroSeguro(fixture.match_hometeam_ft_score);
  const ftAway = obtenerNumeroSeguro(fixture.match_awayteam_ft_score);

  if (ftHome !== '' && ftAway !== '') {
    return { marcador1: ftHome, marcador2: ftAway };
  }

  const goles = Array.isArray(fixture.goalscorer) ? fixture.goalscorer : [];

  const golesRegulares = goles.filter(gol => {
    const periodo = String(gol.score_info_time || '').toLowerCase();
    const info = String(gol.info || '').toLowerCase();

    if (periodo === 'penalty') return false;
    if (periodo.includes('extra time')) return false;
    if (info.includes('penalty')) return false;

    return gol.score && /^\d+\s*-\s*\d+$/.test(gol.score);
  });

  if (golesRegulares.length > 0) {
    const ultimoGol = golesRegulares[golesRegulares.length - 1];
    const [home, away] = ultimoGol.score.split('-').map(n => Number(n.trim()));

    return {
      marcador1: Number.isNaN(home) ? '' : home,
      marcador2: Number.isNaN(away) ? '' : away
    };
  }

  return {
    marcador1: obtenerNumeroSeguro(fixture.match_hometeam_score),
    marcador2: obtenerNumeroSeguro(fixture.match_awayteam_score)
  };
}

function normalizarEquipo(nombre) {
  return (nombre || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function obtenerEstadoPartido(fixture, partido) {
  const estadoRaw = String(fixture?.match_status || partido?.apiStatus || '').trim();

  const estadoLower = estadoRaw.toLowerCase();

  const estadosFinalizados = [
    'finished',
    'ft',
    'after pen.',
    'after et',
    'awarded',
    'penalties'
  ];

  // Partido terminado
  if (estadosFinalizados.includes(estadoLower)) {
    return {
      estado: 'TC',
      minuto: null
    };
  }

  // Medio tiempo
  if (
    estadoLower === 'half time' ||
    estadoLower === 'halftime' ||
    estadoLower === 'ht'
  ) {
    return {
      estado: 'MT',
      minuto: null
    };
  }

  // Tiempo agregado primer tiempo
  if (/^45\+/.test(estadoRaw)) {
    return {
      estado: 'LIVE',
      minuto: '45+'
    };
  }

  // Tiempo agregado segundo tiempo
  if (/^90\+/.test(estadoRaw)) {
    return {
      estado: 'LIVE',
      minuto: '90+'
    };
  }

  // Cualquier minuto numérico significa partido en vivo
  // Ej: "1", "34", "67", "89"
  if (/^\d+$/.test(estadoRaw)) {
    const minuto = Number(estadoRaw);

    if (minuto >= 90) {
      return {
        estado: 'LIVE',
        minuto: '90+'
      };
    }

    if (minuto >= 45 && minuto < 46) {
      return {
        estado: 'LIVE',
        minuto: '45+'
      };
    }

    return {
      estado: 'LIVE',
      minuto
    };
  }

  // Todavía no inicia
  return {
    estado: 'PROGRAMADO',
    minuto: null
  };
}

function tieneValorApi(valor) {
  return valor !== undefined && valor !== null && String(valor).trim() !== '';
}

function huboTiempoExtra(evento) {
  const estado = String(evento?.match_status || '').toLowerCase();

  if (estado.includes('after et')) return true;
  if (estado.includes('after pen')) return true;

  if (
    tieneValorApi(evento?.match_hometeam_extra_score) ||
    tieneValorApi(evento?.match_awayteam_extra_score)
  ) {
    return true;
  }

  const goles = Array.isArray(evento?.goalscorer) ? evento.goalscorer : [];
  const tarjetas = Array.isArray(evento?.cards) ? evento.cards : [];

  const huboEventoExtra = [...goles, ...tarjetas].some(item =>
    String(item.score_info_time || '').toLowerCase().includes('extra time')
  );

  return huboEventoExtra;
}

function huboPenales(evento) {
  const estado = String(evento?.match_status || '').toLowerCase();

  if (estado.includes('after pen')) return true;

  if (
    tieneValorApi(evento?.match_hometeam_penalty_score) ||
    tieneValorApi(evento?.match_awayteam_penalty_score)
  ) {
    return true;
  }

  const goles = Array.isArray(evento?.goalscorer) ? evento.goalscorer : [];

  return goles.some(gol =>
    String(gol.score_info_time || '').toLowerCase() === 'penalty'
  );
}

function numeroDesdeTexto(valor) {
  const n = Number(String(valor || '').replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function minutoApiFootball(item) {
  const raw = String(item?.time || '').replace('+', '.');
  const n = Number(raw);
  return Number.isNaN(n) ? 999 : n;
}


function esGolApiFootball(gol) {
  const info = String(gol?.info || '').toLowerCase();
  const scoreInfoTime = String(gol?.score_info_time || '').toLowerCase();

  if (scoreInfoTime === 'penalty') return false;

  if (info.includes('cancel')) return false;
  if (info.includes('disallow')) return false;
  /*
   * Palabra completa, no subcadena. Antes era info.includes('var'), que anulaba
   * el gol de cualquier jugador apellidado Varela, Varane, Alvarez o Navarro:
   * el gol era legítimo y el jugador se quedaba sin sus puntos de trivia, sin
   * ningún error visible.
   */
  if (/\bvar\b/.test(info)) return false;

  return Boolean(gol?.home_scorer || gol?.away_scorer);
}


function obtenerGolesValidos(evento) {
  return Array.isArray(evento.goalscorer)
    ? evento.goalscorer.filter(esGolApiFootball)
    : [];
}


function obtenerEquipoPrimerGol(trivia, evento) {
  const goles = Array.isArray(evento.goalscorer) ? evento.goalscorer : [];

  const golesValidos = goles
    .filter(esGolApiFootball)
    .sort((a, b) => minutoApiFootball(a) - minutoApiFootball(b));

  if (golesValidos.length === 0) return 'Nadie anotará';

  const primerGol = golesValidos[0];

  const homeApi = normalizarEquipo(evento.match_hometeam_name);
  const awayApi = normalizarEquipo(evento.match_awayteam_name);
  const equipo1 = normalizarEquipo(trivia.equipo1);
  const equipo2 = normalizarEquipo(trivia.equipo2);

  const apiInvertido = homeApi === equipo2 && awayApi === equipo1;

  if (primerGol.home_scorer) {
    return apiInvertido ? trivia.equipo2 : trivia.equipo1;
  }

  if (primerGol.away_scorer) {
    return apiInvertido ? trivia.equipo1 : trivia.equipo2;
  }

  return '';
}

function contarTarjetasPorCards(evento, trivia, tipoTarjeta) {
  const cards = Array.isArray(evento.cards) ? evento.cards : [];

  const homeApi = normalizarEquipo(evento.match_hometeam_name);
  const awayApi = normalizarEquipo(evento.match_awayteam_name);
  const equipo1 = normalizarEquipo(trivia.equipo1);
  const equipo2 = normalizarEquipo(trivia.equipo2);

  const apiInvertido = homeApi === equipo2 && awayApi === equipo1;

  let home = 0;
  let away = 0;

  cards.forEach(card => {
    const tipo = String(card.card || '').toLowerCase();

    if (tipoTarjeta === 'amarilla') {
      if (!tipo.includes('yellow')) return;
    }

    if (tipoTarjeta === 'roja') {
      if (!tipo.includes('red')) return;
    }

    if (card.home_fault) home++;
    if (card.away_fault) away++;
  });

  return {
    equipo1: apiInvertido ? away : home,
    equipo2: apiInvertido ? home : away
  };
}

function contarAmarillasPorStatistics(evento, trivia) {
  const stats = Array.isArray(evento.statistics) ? evento.statistics : [];

  const stat = stats.find(s =>
    String(s.type || '').toLowerCase() === 'yellow cards'
  );

  if (!stat) return null;

  const home = numeroDesdeTexto(stat.home);
  const away = numeroDesdeTexto(stat.away);

  const homeApi = normalizarEquipo(evento.match_hometeam_name);
  const awayApi = normalizarEquipo(evento.match_awayteam_name);
  const equipo1 = normalizarEquipo(trivia.equipo1);
  const equipo2 = normalizarEquipo(trivia.equipo2);

  const apiInvertido = homeApi === equipo2 && awayApi === equipo1;

  return {
    equipo1: apiInvertido ? away : home,
    equipo2: apiInvertido ? home : away
  };
}

function resolverRespuestaTrivia(trivia, evento) {
  if (!evento) return '';

  if (trivia.tipo === 'primer_gol') {
    return obtenerEquipoPrimerGol(trivia, evento);
  }

  if (trivia.tipo === 'mas_amarillas') {
    let conteo = contarTarjetasPorCards(evento, trivia, 'amarilla');

    if (conteo.equipo1 === 0 && conteo.equipo2 === 0) {
      const statsConteo = contarAmarillasPorStatistics(evento, trivia);
      if (statsConteo) conteo = statsConteo;
    }

    if (conteo.equipo1 === 0 && conteo.equipo2 === 0) return 'No habrá tarjetas amarillas';
    if (conteo.equipo1 > conteo.equipo2) return trivia.equipo1;
    if (conteo.equipo2 > conteo.equipo1) return trivia.equipo2;
    return 'Empate';
  }

  if (trivia.tipo === 'mas_rojas') {
    const conteo = contarTarjetasPorCards(evento, trivia, 'roja');

    if (conteo.equipo1 === 0 && conteo.equipo2 === 0) return 'No habrá tarjetas rojas';
    if (conteo.equipo1 > conteo.equipo2) return trivia.equipo1;
    if (conteo.equipo2 > conteo.equipo1) return trivia.equipo2;
    return 'Empate';
  }
  

  if (trivia.tipo === 'ambos_anotan') {
    const goles = Array.isArray(evento.goalscorer) ? evento.goalscorer.filter(esGolApiFootball) : [];

    const homeApi = normalizarEquipo(evento.match_hometeam_name);
    const awayApi = normalizarEquipo(evento.match_awayteam_name);
    const equipo1 = normalizarEquipo(trivia.equipo1);
    const equipo2 = normalizarEquipo(trivia.equipo2);

    const apiInvertido = homeApi === equipo2 && awayApi === equipo1;

    let homeAnoto = false;
    let awayAnoto = false;

    goles.forEach(gol => {
      if (gol.home_scorer) homeAnoto = true;
      if (gol.away_scorer) awayAnoto = true;
    });

    const equipo1Anoto = apiInvertido ? awayAnoto : homeAnoto;
    const equipo2Anoto = apiInvertido ? homeAnoto : awayAnoto;

    return equipo1Anoto && equipo2Anoto ? 'Sí' : 'No';
  }

  if (trivia.tipo === 'gol_primer_tiempo') {
  const goles = obtenerGolesValidos(evento);

  const hayGolPrimerTiempo = goles.some(gol => {
    const minuto = minutoApiFootball(gol);
    return minuto > 0 && minuto <= 45.99;
  });

  return hayGolPrimerTiempo ? 'Sí' : 'No';
}

if (trivia.tipo === 'gol_segundo_tiempo') {
  const goles = obtenerGolesValidos(evento);

  const hayGolSegundoTiempo = goles.some(gol => {
    const minuto = minutoApiFootball(gol);
    return minuto >= 46;
  });

  return hayGolSegundoTiempo ? 'Sí' : 'No';
}

if (trivia.tipo === 'hubo_tiempo_extra') {
  return huboTiempoExtra(evento) ? 'Sí' : 'No';
}

if (trivia.tipo === 'hubo_penales') {
  return huboPenales(evento) ? 'Sí' : 'No';
}



  return '';
}

module.exports = {
  obtenerNumeroSeguro, normalizarEquipo,
  obtenerMarcador90Minutos, obtenerEstadoPartido,
  tieneValorApi, huboTiempoExtra, huboPenales,
  numeroDesdeTexto, minutoApiFootball, esGolApiFootball, obtenerGolesValidos,
  obtenerEquipoPrimerGol, contarTarjetasPorCards, contarAmarillasPorStatistics,
  resolverRespuestaTrivia
};
