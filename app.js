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
        }, function(error) {
            console.error("Error cargando telemetría:", error);
            panel.innerHTML = `<div style="padding: 15px; background: #fee2e2; color: #b91c1c; border-radius: 4px; border: 1px solid #f87171;">
                <strong>Error de conexión:</strong> No se han podido descargar los datos del vehículo. Tu sesión podría haber caducado.
            </div>`;
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
            
            if (inputSearch) inputSearch.placeholder = "Cargando flota, por favor espera...";

            api.call("Get", { typeName: "Device" }, function (devices) {
                devices.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

                devices.forEach(d => {
                    if (d.name) {
                        let option = document.createElement('option');
                        option.value = d.name;
                        dataList.appendChild(option);
                        deviceMap[d.name] = d.id;
                    }
                });

                if (inputSearch) inputSearch.placeholder = "Escribe o selecciona una unidad...";
                console.log(`Buscador inicializado con ${devices.length} activos.`);
            }, function(error) {
                // MANEJO DEL ERROR 400 DE SESIÓN
                console.error("Error crítico cargando dispositivos:", error);
                
                if (inputSearch) {
                    inputSearch.placeholder = "⚠️ Error de sesión detectado.";
                    inputSearch.disabled = true; // Bloqueamos el buscador
                }
                
                if (panel) {
                    panel.innerHTML = `
                    <div style="padding: 15px; background: #fee2e2; color: #b91c1c; border-radius: 4px; border: 1px solid #f87171; margin-top: 15px;">
                        <strong style="font-size: 16px;">Error de Sesión Invalida</strong><br><br>
                        Se ha detectado un cruce de sesiones, probablemente por haber iniciado sesión en otro dispositivo móvil con este mismo usuario.<br><br>
                        <strong>Solución recomendada:</strong><br>
                        1. Cierra la sesión en Geotab.<br>
                        2. Limpia la caché y los datos de la aplicación en tu móvil.<br>
                        3. Vuelve a iniciar sesión.
                    </div>`;
                }
            });

            inputSearch.addEventListener('input', function() {
                if (deviceMap[this.value]) {
                    loadReeferData(deviceMap[this.value]);
                }
            });

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
            // PROTECCIÓN EXTRA: Si entras desde Geotab Drive y el state te pasa el vehículo asignado, lo cargamos
            if (state && state.device && state.device.id) {
                currentDeviceId = state.device.id;
                
                // Actualizamos visualmente el buscador si ya conocemos el nombre
                if (inputSearch && !inputSearch.value) {
                    const devName = Object.keys(deviceMap).find(key => deviceMap[key] === currentDeviceId);
                    if (devName) inputSearch.value = devName;
                }
            }

            if (currentDeviceId) {
                loadReeferData(currentDeviceId);
                refreshInterval = setInterval(() => {
                    if (currentDeviceId) loadReeferData(currentDeviceId);
                }, 60000);
            }
        },
        blur: function () {
            if (refreshInterval) clearInterval(refreshInterval);
        }
    };
};
