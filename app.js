geotab.addin.reeferMonitor = function (api, state) {
    // 1. Configuración Maestra de Diagnósticos
    const DIAG_CONFIG = {
        "RefrigerationUnitSetTemperatureZone1Id": { label: "Set Point Zona 1", type: "temp", force: true },
        "RefrigerationUnitSetTemperatureZone2Id": { label: "Set Point Zona 2", type: "temp", force: true },
        "RefrigerationUnitStatusId": { label: "Estado de la unidad", type: "status", force: true },
        "DiagnosticCargoTemperatureZone1Id": { label: "Temp. Carga Zona 1", type: "temp", force: false },
        "DiagnosticCargoTemperatureZone2Id": { label: "Temp. Carga Zona 2", type: "temp", force: false },
        "DiagnosticCargoTemperatureZone3Id": { label: "Temp. Carga Zona 3", type: "temp", force: false },
        "RefrigerationUnitSetTemperatureZone3Id": { label: "Set Point Zona 3", type: "temp", force: false },
        "RefrigerationUnitDischargeTemperatureZone1Id": { label: "Descarga Zona 1", type: "temp", force: false },
        "RefrigerationUnitDischargeTemperatureZone2Id": { label: "Descarga Zona 2", type: "temp", force: false },
        "RefrigerationUnitDischargeTemperatureZone3Id": { label: "Descarga Zona 3", type: "temp", force: false },
        "DiagnosticDoor1StatusId": { label: "Puerta 1", type: "door", force: false },
        "DiagnosticDoor2StatusId": { label: "Puerta 2", type: "door", force: false }
    };

    // Paleta de colores limpios para el gráfico
    const CHART_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

    let refreshInterval = null;
    let chartInstance = null;
    let deviceMap = {};
    let currentDeviceId = null;

    // Referencias DOM
    const inputSearch = document.getElementById('deviceSearch');
    const dataList = document.getElementById('devicesList');
    const btnRefresh = document.getElementById('btn-fetch-data');
    const panel = document.getElementById('results-panel');

    function loadReeferData(deviceId) {
        if (!deviceId) return;
        currentDeviceId = deviceId;
        
        // Rango de 24 horas
        const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const diagKeys = Object.keys(DIAG_CONFIG);
        
        // Preparamos las llamadas para todos los diagnósticos
        let calls = diagKeys.map(id => ["Get", {
            typeName: "StatusData",
            search: { deviceSearch: { id: deviceId }, diagnosticSearch: { id: id }, fromDate: fromDate }
        }]);

        // Llamada extra para obtener Fallos/Alertas Activas (aproximación)
        calls.push(["Get", {
            typeName: "FaultData",
            search: { deviceSearch: { id: deviceId }, fromDate: fromDate }
        }]);

        api.multiCall(calls, function(results) {
            const faultsData = results.pop(); // Sacamos el último resultado (Alertas)
            const telemetryData = results;    // El resto es telemetría
            
            renderTable(telemetryData, diagKeys, faultsData.length);
            renderChart(telemetryData, diagKeys);
        });
    }

    function renderTable(telemetryData, diagKeys, totalAlerts) {
        let html = '<table style="width:100%; border-collapse: collapse; margin-top: 15px;">';
        html += '<tr style="background:#f3f4f6; border-bottom: 2px solid #cbd5e1;"><th style="text-align:left; padding:10px;">Medición</th><th style="text-align:right; padding:10px;">Valor Actual</th></tr>';
        
        telemetryData.forEach((data, index) => {
            const key = diagKeys[index];
            const cfg = DIAG_CONFIG[key];
            const hasData = data && data.length > 0;
            
            if (cfg.force || hasData) {
                let displayValue = "---";
                if (hasData) {
                    const rawVal = data[data.length - 1].data;
                    displayValue = cfg.type === 'temp' ? `${rawVal.toFixed(1)} ºC` : rawVal;
                }
                html += `<tr style="border-bottom: 1px solid #e2e8f0;">
                            <td style="padding: 10px;">${cfg.label}</td>
                            <td style="padding: 10px; text-align:right; font-weight:bold;">${displayValue}</td>
                         </tr>`;
            }
        });

        // Fila obligatoria de Total Alertas Activas
        html += `<tr style="border-bottom: 1px solid #e2e8f0; background: #fff1f2;">
                    <td style="padding: 10px; color: #be123c;">Total Alertas Activas (24h)</td>
                    <td style="padding: 10px; text-align:right; font-weight:bold; color: #be123c;">${totalAlerts}</td>
                 </tr>`;
        
        html += '</table>';
        panel.innerHTML = html;
    }

    function renderChart(telemetryData, diagKeys) {
        const ctx = document.getElementById('reeferChart').getContext('2d');
        const datasets = [];
        let colorIndex = 0;

        telemetryData.forEach((data, index) => {
            const key = diagKeys[index];
            const cfg = DIAG_CONFIG[key];
            
            // Solo graficar si hay datos y si es un sensor de temperatura (ignorar puertas y estados booleanos)
            if (data && data.length > 0 && cfg.type === 'temp') {
                datasets.push({
                    label: cfg.label,
                    data: data.map(d => ({ x: new Date(d.dateTime), y: d.data })),
                    borderColor: CHART_COLORS[colorIndex % CHART_COLORS.length],
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 0, // Estilo limpio sin puntos enormes
                    pointHoverRadius: 4,
                    tension: 0.2 // Suavizado de curva
                });
                colorIndex++;
            }
        });

        if (chartInstance) chartInstance.destroy();

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: { datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'hour', tooltipFormat: 'dd/MM/yyyy HH:mm' },
                        title: { display: true, text: 'Últimas 24 Horas' }
                    },
                    y: {
                        title: { display: true, text: 'Temperatura (ºC)' }
                    }
                },
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    }

    return {
        initialize: function (api, state, callback) {
            // Cargar vehículos para el buscador
            api.call("Get", { typeName: "Device" }, function (devices) {
                devices.forEach(d => {
                    if (d.name) {
                        let option = document.createElement('option');
                        option.value = d.name;
                        dataList.appendChild(option);
                        deviceMap[d.name] = d.id;
                    }
                });
            });

            // Evento: Al seleccionar un vehículo en el datalist
            inputSearch.addEventListener('input', function() {
                if (deviceMap[this.value]) {
                    loadReeferData(deviceMap[this.value]);
                }
            });

            // Evento: Botón manual
            btnRefresh.addEventListener('click', () => {
                if (currentDeviceId) loadReeferData(currentDeviceId);
            });

            callback();
        },
        focus: function (api, state) {
            // Activar Auto-Update cada 60 segundos al abrir
            if (currentDeviceId) loadReeferData(currentDeviceId);
            refreshInterval = setInterval(() => {
                if (currentDeviceId) loadReeferData(currentDeviceId);
            }, 60000);
        },
        blur: function () {
            // Detener Auto-Update al cerrar la pestaña o cambiar de menú
            if (refreshInterval) clearInterval(refreshInterval);
        }
    };
};
