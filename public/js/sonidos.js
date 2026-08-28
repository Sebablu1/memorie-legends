// Sonidos sintetizados con WebAudio: no hacen falta archivos ni descargas.
// El navegador exige un gesto del usuario antes de sonar, así que el contexto
// se crea perezosamente y se reanuda en el primer clic.

let ctx = null;
let silenciado = false;

function contexto() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

document.addEventListener("pointerdown", () => contexto(), { once: true });

export function alternarSilencio() {
  silenciado = !silenciado;
  return silenciado;
}

export const estaSilenciado = () => silenciado;

/** Un tono simple con envolvente exponencial. */
function tono({ frecuencia, desde = frecuencia, duracion = 0.18, tipo = "sine", volumen = 0.2, retraso = 0 }) {
  const ac = contexto();
  if (!ac || silenciado) return;

  const inicio = ac.currentTime + retraso;
  const osc = ac.createOscillator();
  const ganancia = ac.createGain();

  osc.type = tipo;
  osc.frequency.setValueAtTime(desde, inicio);
  if (frecuencia !== desde) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, frecuencia), inicio + duracion);
  }

  ganancia.gain.setValueAtTime(0.0001, inicio);
  ganancia.gain.exponentialRampToValueAtTime(volumen, inicio + 0.012);
  ganancia.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);

  osc.connect(ganancia).connect(ac.destination);
  osc.start(inicio);
  osc.stop(inicio + duracion + 0.02);
}

/** Ráfaga de ruido: sirve para el roce de las cartas. */
function ruido({ duracion = 0.16, volumen = 0.12, corte = 2200, retraso = 0 }) {
  const ac = contexto();
  if (!ac || silenciado) return;

  const inicio = ac.currentTime + retraso;
  const muestras = Math.floor(ac.sampleRate * duracion);
  const buffer = ac.createBuffer(1, muestras, ac.sampleRate);
  const datos = buffer.getChannelData(0);
  for (let i = 0; i < muestras; i++) {
    datos[i] = (Math.random() * 2 - 1) * (1 - i / muestras);
  }

  const fuente = ac.createBufferSource();
  fuente.buffer = buffer;

  const filtro = ac.createBiquadFilter();
  filtro.type = "bandpass";
  filtro.frequency.value = corte;

  const ganancia = ac.createGain();
  ganancia.gain.setValueAtTime(volumen, inicio);
  ganancia.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);

  fuente.connect(filtro).connect(ganancia).connect(ac.destination);
  fuente.start(inicio);
}

export const sonidos = {
  clic: () => tono({ frecuencia: 620, desde: 900, duracion: 0.06, tipo: "triangle", volumen: 0.11 }),

  voltear: () => ruido({ duracion: 0.13, volumen: 0.16, corte: 2600 }),

  // Carta que sale disparada al descarte: ruido más largo y grave que el volteo.
  whoosh: () => {
    ruido({ duracion: 0.26, volumen: 0.17, corte: 1100 });
    tono({ frecuencia: 180, desde: 520, duracion: 0.22, tipo: "sine", volumen: 0.07 });
  },

  repartir: () => {
    for (let i = 0; i < 4; i++) ruido({ duracion: 0.1, volumen: 0.1, corte: 2400, retraso: i * 0.09 });
  },

  acierto: () => {
    tono({ frecuencia: 880, duracion: 0.1, tipo: "sine", volumen: 0.16 });
    tono({ frecuencia: 1320, duracion: 0.16, tipo: "sine", volumen: 0.12, retraso: 0.08 });
  },

  error: () => {
    tono({ frecuencia: 90, desde: 190, duracion: 0.3, tipo: "sawtooth", volumen: 0.14 });
  },

  poder: () => {
    tono({ frecuencia: 1400, desde: 500, duracion: 0.32, tipo: "triangle", volumen: 0.14 });
  },

  aviso: () => tono({ frecuencia: 700, duracion: 0.09, tipo: "square", volumen: 0.07 }),

  corte: () => {
    [523.25, 659.25, 783.99].forEach((f, i) =>
      tono({ frecuencia: f, duracion: 0.3, tipo: "sine", volumen: 0.14, retraso: i * 0.07 }),
    );
  },

  victoria: () => {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      tono({ frecuencia: f, duracion: 0.5, tipo: "triangle", volumen: 0.15, retraso: i * 0.11 }),
    );
  },

  derrota: () => {
    [440, 370, 294].forEach((f, i) =>
      tono({ frecuencia: f, duracion: 0.4, tipo: "sine", volumen: 0.13, retraso: i * 0.14 }),
    );
  },
};
