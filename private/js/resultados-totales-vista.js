/*
 * Extraído del marcado de resultados-totales.html.
 *
 * Vivía en un <script> dentro del HTML, lo que obligaba a la política de
 * seguridad a permitir `script-src 'unsafe-inline'`. El código es el mismo;
 * lo único que cambia es dónde vive.
 */
'use strict';

window.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => {
        const boton = document.getElementById("calcularResultados");
        if (boton) boton.click();
      }, 500);
    });

document.getElementById("volverButton").addEventListener("click", () => {
      window.location.href = "index.html";
    });

    function crearVistaMovilResultados() {
      const table = document.getElementById("resultadosTotalesTable");
      const mobileContainer = document.getElementById("mobileResultadosContainer");

      if (!table || !mobileContainer) return;

      const headers = Array.from(table.querySelectorAll("thead th")).map(th =>
        th.textContent.trim()
      );

      const rows = Array.from(table.querySelectorAll("tbody tr"));

      if (headers.length < 2 || rows.length === 0) return;

      mobileContainer.innerHTML = "";

      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll("td"));

        if (cells.length === 0) return;

        const jugador = cells[0]?.textContent.trim() || "";
        const total = cells[cells.length - 1]?.textContent.trim() || "0";

        const card = document.createElement("div");
        card.className = "mobile-result-card";

        /*
         * Este codigo vivia dentro del HTML, asi que el guardian de S-04 no lo
         * miraba: al sacarlo aparecio construyendo marcado con datos sin
         * escapar. Los datos salen de la tabla de escritorio, cuyo contenido
         * incluye nombres de jugador y de jornada.
         */
        const jornadas = [];

        for (let i = 1; i < cells.length - 1; i++) {
          jornadas.push(html`
            <div class="mobile-result-row">
              <span>${headers[i]}</span>
              <strong>${cells[i].textContent.trim()}</strong>
            </div>
          `);
        }

        card.innerHTML = html`
          <div class="mobile-result-header">
            <h3>${jugador}</h3>

            <div class="mobile-total">
              <span>Total</span>
              <strong>${total}</strong>
            </div>
          </div>

          <div class="mobile-jornadas">
            ${jornadas}
          </div>
        `;

        mobileContainer.appendChild(card);
      });
    }

    window.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => {
        crearVistaMovilResultados();
      }, 1200);
    });

    document.addEventListener("click", event => {
      if (event.target && event.target.id === "calcularResultados") {
        setTimeout(() => {
          crearVistaMovilResultados();
        }, 800);
      }
    });
