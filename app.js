geotab.addin.reeferMonitor = function (api, state) {
    
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

    const CHART_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
    let refreshInterval = null;
    let chartInstance = null;
    let deviceMap = {};
    let currentDeviceId = null;

    const inputSearch = document.getElementById('deviceSearch');
    const dataList = document.getElementById('devicesList');
    const btnRefresh = document.getElementById('btn-fetch-data');
    const panel = document.getElementById('results-panel');

    function loadReeferData(deviceId) {
        if (!deviceId) return;
        currentDeviceId = deviceId;
        
        const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const diagKeys = Object.keys(DIAG_CONFIG);
        
        let calls = diagKeys.map(id => ["Get", {
            typeName: "StatusData",
            search: { deviceSearch: { id: deviceId }, diagnosticSearch: { id: id }, fromDate: fromDate }
        }]);

        calls.push(["Get", {
            typeName: "FaultData",
            search: { deviceSearch: { id: deviceId }, fromDate: fromDate }
        }]);

        api.multiCall(calls, function(results) {
            const faultsData = results.pop();
            const telemetryData = results;
            
            renderTable(telemetryData, diagKeys, faultsData.length);
            renderChart(telemetryData, diagKeys);
        });
    }

    function renderTable(telemetryData, diagKeys, totalAlerts) {
        let html = '<table style="width:100%; border-collapse: collapse; margin-top: 15px; font-family: sans-serif;">';
        html += '<tr style="background:#f3f4f6; border-bottom: 2px solid #cbd5e1;"><th style="text-align:left; padding:12px;">Medición</th><th style="text-align:right; padding:12px;">Valor / Validez</th></tr>';
        
        telemetryData.forEach((data, index) => {
            const key = diagKeys[index];
            const cfg = DIAG_CONFIG[key];
            const hasData = data && data.length > 0;
            
            if (cfg.force || hasData) {
                let displayValue = "---";
                let timeWarningHtml = "";

                if (hasData) {
                    const lastRecord = data[data.length - 1];
                    const rawVal = lastRecord.data;
                    displayValue = cfg.type === 'temp' ? `${rawVal.toFixed(1)} ºC` : rawVal;

                    const recordTime = new Date(lastRecord.dateTime);
                    const diffMinutes = Math.floor((Date.now() - recordTime) / 60000);

                    if (diffMinutes <= 15) {
                        timeWarningHtml = `<span style="display:block; font-size:11px; color:#16a34a;">✔ Tiempo real</span>`;
                    } else if (diffMinutes < 60) {
                        timeWarningHtml = `<span style="display:block; font-size:11px; color:#d97706; font-weight:bold;">⚠ Hace ${diffMinutes} min</span>`;
                    } else {
                        const diffHours = Math.floor(diffMinutes / 60);
                        const formattedTime = recordTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                        timeWarningHtml = `<span style="display:block; font-size:11px; color:#dc2626; font-weight:bold;">❌ Desconectado (Hora: ${formattedTime} - Hace ${diffHours}h)</span>`;
                    }
                } else if (cfg.force) {
                    timeWarningHtml = `<span style="display:block; font-size:11px; color:#94a3b8;">Sin registros</span>`;
                }

                html += `<tr style="border-bottom: 1px solid #e2e8f0;">
                            <td style="padding: 12px; font-weight: 500; color:#1e293b;">${cfg.label}</td>
                            <td style="padding: 12px; text-align:right; font-weight:bold; color:#0f172a;">
                                ${displayValue} ${timeWarningHtml}
                            </td>
                         </tr>`;
            }
        });

        html += `<tr style="border-bottom: 1px solid #e2e8f0; background: #fff1f2;">
                    <td style="padding: 12px; color: #be123c; font-weight: bold;">Total Alertas Activas (24h)</td>
                    <td style="padding: 12px; text-align:right; font-weight:bold; color: #be123c;">${totalAlerts}</td>
                 </tr>`;
        
        html += '</table>';
        panel.innerHTML = html;
    }

    function renderChart(telemetryData, diagKeys) {
        const ctx = document.getElementById('reeferChart').getContext('2d');
        const datasets = [];
        let colorIndex = 0;

        const now = new Date();
        const limitsFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        telemetryData.forEach((data, index) => {
            const key = diagKeys[index];
            const cfg = DIAG_CONFIG[key];
            
            if (data && data.length > 0 && cfg.type === 'temp') {
                datasets.push({
                    label: cfg.label,
                    data: data.map(d => ({ x: new Date(d.dateTime), y: d.data })),
                    borderColor: CHART_COLORS[colorIndex % CHART_COLORS.length],
                    backgroundColor: 'transparent',
                    borderWidth: 2.5,
                    pointRadius: 1,
                    pointHoverRadius: 5,
                    tension: 0.1
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
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'time',
                        min: limitsFrom,
                        max: now,
                        time: {
                            unit: 'hour',
                            stepSize: 2,
                            displayFormats: { hour: 'HH:mm' },
                            tooltipFormat: 'dd/MM HH:mm'
                        },
                        grid: { color: '#f1f5f9' },
                        title: { display: true, text: 'Línea de tiempo (Últimas 24 Horas)', color: '#64748b' }
                    },
                    y: {
                        grid: { color: '#e2e8f0' },
                        title: { display: true, text: 'Temperatura (ºC)', color: '#64748b' }
                    }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
                }
            }
        });
    }

    return {
        initialize: function (api, state, callback) {
            
            // 1. Mostrar estado de carga para flotas grandes
            if (inputSearch) inputSearch.placeholder = "Cargando flota, por favor espera...";

            api.call("Get", { typeName: "Device" }, function (devices) {
                
                // 2. Ordenar alfabéticamente para que el datalist filtre a la perfección
                devices.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

                devices.forEach(d => {
                    if (d.name) {
                        let option = document.createElement('option');
                        option.value = d.name;
                        dataList.appendChild(option);
                        deviceMap[d.name] = d.id;
                    }
                });

                // 3. Restaurar placeholder cuando ya tengamos los datos
                if (inputSearch) inputSearch.placeholder = "Escribe o selecciona una unidad...";
                console.log(`Buscador inicializado con ${devices.length} activos.`);
            }, function(error) {
                console.error("Error cargando dispositivos:", error);
                if (inputSearch) inputSearch.placeholder = "Error al cargar flota.";
            });

            // Disparar búsqueda automática al seleccionar en el desplegable
            inputSearch.addEventListener('input', function() {
                if (deviceMap[this.value]) {
                    loadReeferData(deviceMap[this.value]);
                }
            });

            // Blindar el botón "Actualizar" para que lea la caja de texto sí o sí
            btnRefresh.addEventListener('click', () => {
                const selectedName = inputSearch.value;
                const foundId = deviceMap[selectedName];
                
                if (foundId) {
                    loadReeferData(foundId);
                } else if (currentDeviceId) {
                    loadReeferData(currentDeviceId);
                } else {
                    alert("Por favor, selecciona un vehículo válido de la lista para actualizar.");
                }
            });

            callback();
        },
        focus: function (api, state) {
            if (currentDeviceId) loadReeferData(currentDeviceId);
            refreshInterval = setInterval(() => {
                if (currentDeviceId) loadReeferData(currentDeviceId);
            }, 60000);
        },
        blur: function () {
            if (refreshInterval) clearInterval(refreshInterval);
        }
    };
};
