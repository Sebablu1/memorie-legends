// Confeti de celebración sobre un canvas a pantalla completa.
// Se apaga solo cuando ya no quedan partículas vivas.

const COLORES = ["#d4a843", "#f0d060", "#c0c0c0", "#ffffff", "#a0a0a0", "#b87333"];

export function lanzarConfeti(lienzo, { cantidad = 160, duracion = 4200 } = {}) {
  const ctx = lienzo.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  const ajustar = () => {
    lienzo.width = lienzo.clientWidth * dpr;
    lienzo.height = lienzo.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  ajustar();
  window.addEventListener("resize", ajustar);

  const ancho = () => lienzo.clientWidth;
  const alto = () => lienzo.clientHeight;

  const particulas = Array.from({ length: cantidad }, () => ({
    x: Math.random() * ancho(),
    y: -20 - Math.random() * alto() * 0.5,
    ancho: 6 + Math.random() * 7,
    alto: 9 + Math.random() * 12,
    color: COLORES[Math.floor(Math.random() * COLORES.length)],
    vx: -1.2 + Math.random() * 2.4,
    vy: 2 + Math.random() * 3.2,
    giro: Math.random() * Math.PI,
    vgiro: -0.14 + Math.random() * 0.28,
    balanceo: Math.random() * Math.PI * 2,
  }));

  lienzo.classList.add("activo");
  const inicio = performance.now();
  let animacion = null;

  function cuadro(ahora) {
    const transcurrido = ahora - inicio;
    const desvanecer = Math.max(0, 1 - Math.max(0, transcurrido - duracion * 0.6) / (duracion * 0.4));

    ctx.clearRect(0, 0, ancho(), alto());

    let vivas = 0;
    for (const p of particulas) {
      p.balanceo += 0.05;
      p.x += p.vx + Math.sin(p.balanceo) * 0.8;
      p.y += p.vy;
      p.giro += p.vgiro;

      if (p.y < alto() + 40) vivas++;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.giro);
      ctx.globalAlpha = desvanecer;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.ancho / 2, -p.alto / 2, p.ancho, p.alto * Math.abs(Math.cos(p.giro)));
      ctx.restore();
    }

    if (vivas > 0 && transcurrido < duracion) {
      animacion = requestAnimationFrame(cuadro);
    } else {
      ctx.clearRect(0, 0, ancho(), alto());
      lienzo.classList.remove("activo");
      window.removeEventListener("resize", ajustar);
      if (animacion) cancelAnimationFrame(animacion);
    }
  }

  animacion = requestAnimationFrame(cuadro);
}
