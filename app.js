geotab.addin.reeferMonitor = function (api, state) {
    // Lista de diagnósticos maestra
    const DIAG_CONFIG = {
        "DiagnosticCargoTemperatureZone1Id": { label: "Temp. Carga Zona 1", type: "temp" },
        "DiagnosticCargoTemperatureZone2Id": { label: "Temp. Carga Zona 2", type: "temp" },
        "RefrigerationUnitSetTemperatureZone1Id": { label: "Set Point Zona 1", type: "temp", force: true },
        "RefrigerationUnitSetTemperatureZone2Id": { label: "Set Point Zona 2", type: "temp", force: true },
        "RefrigerationUnitStatusId": { label: "Estado Unidad", type: "status", force: true },
        // ... añadir aquí el resto de diagnósticos de tu lista
    };

    let refreshInterval = null;
    let chart = null;

    function fetchData(deviceId) {
        const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        
        // Llamada masiva dinámica
        const calls = Object.keys(DIAG_CONFIG).map(id => ["Get", {
            typeName: "StatusData",
            search: { deviceSearch: { id: deviceId }, diagnosticSearch: { id: id }, fromDate: fromDate }
        }]);

        api.multiCall(calls, (results) => {
            renderTable(results);
            renderChart(results);
        });
    }

    function renderTable(results) {
        let html = '<table class="data-table"><thead><tr><th>Medición</th><th>Valor</th></tr></thead><tbody>';
        
        results.forEach((data, index) => {
            const diagId = Object.keys(DIAG_CONFIG)[index];
            const cfg = DIAG_CONFIG[diagId];
            const lastVal = data.length ? data[data.length - 1].data : null;

            // Lógica: Mostrar siempre si es 'force', o si tiene datos reales
            if (cfg.force || lastVal !== null) {
                html += `<tr><td>${cfg.label}</td><td>${lastVal ?? "---"}</td></tr>`;
            }
        });
        html += '</tbody></table>';
        document.getElementById('results-panel').innerHTML = html;
    }

    // Configuración del gráfico con estilo limpio
    function renderChart(results) {
        const ctx = document.getElementById('reeferChart').getContext('2d');
        if (chart) chart.destroy();

        chart = new Chart(ctx, {
            type: 'line',
            data: { datasets: formatDatasets(results) },
            options: {
                responsive: true,
                interaction: { intersect: false },
                scales: { x: { type: 'time', time: { unit: 'hour' } } }
            }
        });
    }

    return {
        focus: function (api, state) {
            // Iniciar actualización cada 60 segundos
            refreshInterval = setInterval(() => fetchData(state.device.id), 60000);
            fetchData(state.device.id);
        },
        blur: function () {
            clearInterval(refreshInterval); // Detener al cerrar
        }
    };
};
