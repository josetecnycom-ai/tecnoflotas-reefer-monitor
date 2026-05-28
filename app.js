/**
 * Add-in de Monitorización de Frigoríficos - Tecnoflotas
 * Versión corregida: Solución al crash del Date Adapter de Chart.js
 */
geotab.addin.reeferMonitor = function (api, state) {
    
    const DIAGNOSTICS_MAP = {
        "RefrigerationUnitStatusId": "Estado de la Unidad",
        "DiagnosticCargoTemperatureZone1Id": "Temperatura Carga Zona 1",
        "RefrigerationUnitSetTemperatureZone1Id": "Set Point Zona 1",
        "DiagnosticCargoTemperatureZone2Id": "Temperatura Carga Zona 2",
        "RefrigerationUnitSetTemperatureZone2Id": "Set Point Zona 2",
        "DiagnosticCargoTemperatureZone3Id": "Temperatura Carga Zona 3",
        "RefrigerationUnitSetTemperatureZone3Id": "Set Point Zona 3",
        "DiagnosticDoor1StatusId": "Estado Puerta 1",
        "DiagnosticDoor2StatusId": "Estado Puerta 2",
        "RefrigerationUnitDischargeTemperatureZone1Id": "Temp. Impulsión Zona 1",
        "RefrigerationUnitDischargeTemperatureZone2Id": "Temp. Impulsión Zona 2",
        "RefrigerationUnitDischargeTemperatureZone3Id": "Temp. Impulsión Zona 3"
    };

    const ALWAYS_VISIBLE = [
        "RefrigerationUnitStatusId",
        "RefrigerationUnitSetTemperatureZone1Id",
        "RefrigerationUnitSetTemperatureZone2Id",
        "RefrigerationUnitSetTemperatureZone3Id"
    ];

    let elResultsPanel;
    let refreshIntervalId = null;
    let myChartInstance = null;
    let currentDeviceId = null; 

    function loadReeferData() {
        if (!currentDeviceId) {
            elResultsPanel.innerHTML = "<p class='error-msg'>Por favor, seleccione o vincule un vehículo válido.</p>";
            return;
        }

        api.call("Get", {
            typeName: "TrailerAttachment",
            search: {
                deviceSearch: { id: currentDeviceId }
            }
        }, function (attachments) {
            let targetFetchId = currentDeviceId; 

            if (attachments && attachments.length > 0) {
                const now = new Date();
                const activeAttachment = attachments.find(a => !a.toDate || new Date(a.toDate) > now);
                if (activeAttachment && activeAttachment.trailer) {
                    targetFetchId = activeAttachment.trailer.id;
                }
            }
            fetchTelemetryData(targetFetchId);

        }, function (error) {
            // Si falla por tipo de activo (ej. Trailer ID directo), procesamos directamente con el ID actual
            fetchTelemetryData(currentDeviceId);
        });
    }

    function fetchTelemetryData(assetId) {
        const calls = Object.keys(DIAGNOSTICS_MAP).map(diagnosticId => {
            return [
                "Get",
                {
                    typeName: "StatusData",
                    search: {
                        deviceSearch: { id: assetId },
                        diagnosticSearch: { id: diagnosticId },
                        fromDate: new Date(new Date() - 86400000).toISOString() // Últimas 24 horas
                    }
                }
            ];
        });

        api.multiCall(calls, function (results) {
            let htmlTable = '<table class="reefer-table"><thead><tr><th>Indicador</th><th>Valor Actual</th></tr></thead><tbody>';
            let chartDatasets = [];
            
            const colorPalette = {
                "DiagnosticCargoTemperatureZone1Id": "#10b981", 
                "DiagnosticCargoTemperatureZone2Id": "#ef4444", 
                "DiagnosticCargoTemperatureZone3Id": "#3b82f6", 
                "RefrigerationUnitDischargeTemperatureZone1Id": "#f59e0b" 
            };

            Object.keys(DIAGNOSTICS_MAP).forEach((diagnosticId, index) => {
                const label = DIAGNOSTICS_MAP[diagnosticId];
                const dataBlock = results[index] || [];
                const hasData = dataBlock.length > 0;

                if (!hasData && !ALWAYS_VISIBLE.includes(diagnosticId)) {
                    return; 
                }

                let displayValue = "<span class='no-data'>Sin datos</span>";
                if (hasData) {
                    let latestRecord = dataBlock[dataBlock.length - 1];
                    displayValue = diagnosticId.toLowerCase().includes("temperature") 
                        ? `${parseFloat(latestRecord.data).toFixed(1)} ºC` 
                        : latestRecord.data;
                }

                htmlTable += `<tr><td><strong>${label}</strong></td><td>${displayValue}</td></tr>`;

                // Mapeo seguro de puntos usando marcas de tiempo numéricas para evitar el uso de objetos Date puros en el eje
                if (hasData && diagnosticId.toLowerCase().includes("temperature") && colorPalette[diagnosticId]) {
                    const points = dataBlock.map(record => ({
                        x: new Date(record.dateTime).getTime(), // Timestamp numérico (Epoch ms)
                        y: parseFloat(record.data)
                    }));

                    chartDatasets.push({
                        label: label,
                        data: points,
                        borderColor: colorPalette[diagnosticId],
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 1.5,
                        tension: 0.2
                    });
                }
            });

            htmlTable += '</tbody></table>';
            
            // Renderizado prioritario de la tabla (así aseguramos visualización inmediata de datos actuales)
            elResultsPanel.innerHTML = htmlTable;

            // Renderizado del gráfico libre de dependencias de fechas
            renderChart(chartDatasets);

        }, function (error) {
            console.error("Error en multiCall:", error);
            elResultsPanel.innerHTML = `<p class='error-msg'>Error al procesar la telemetría del activo.</p>`;
        });
    }

    function renderChart(datasets) {
        const canvas = document.getElementById('reeferChart');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        if (myChartInstance) {
            myChartInstance.destroy();
        }

        myChartInstance = new Chart(ctx, {
            type: 'line',
            data: { datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear', // Cambiado a lineal para evitar la necesidad del Date Adapter externo
                        ticks: {
                            callback: function(value) {
                                // Convertimos dinámicamente el timestamp de vuelta a formato HH:mm legible
                                const date = new Date(value);
                                const hh = String(date.getHours()).padStart(2, '0');
                                const mm = String(date.getMinutes()).padStart(2, '0');
                                return `${hh}:${mm}`;
                            }
                        },
                        grid: { color: '#e5e7eb' }
                    },
                    y: { 
                        ticks: {
                            callback: function(value) { return value + ' ºC'; }
                        },
                        grid: { color: '#e5e7eb' } 
                    }
                }
            }
        });
    }

    function setupWebDeviceSelector() {
        const selectorZone = document.getElementById('web-vehicle-selector-zone');
        const selectEl = document.getElementById('vehicle-select');
        
        if (!selectorZone || !selectEl) return;

        api.call("Get", { typeName: "Device" }, function (devices) {
            if (devices && devices.length > 0) {
                selectorZone.style.display = 'block';
                selectEl.innerHTML = devices.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
                
                currentDeviceId = selectEl.value;
                loadReeferData();

                selectEl.addEventListener('change', function(e) {
                    currentDeviceId = e.target.value;
                    loadReeferData();
                });
            }
        });
    }

    return {
        initialize: function (api, state, callback) {
            elResultsPanel = document.getElementById('results-panel');
            const btn = document.getElementById('btn-fetch-data');
            if (btn) {
                btn.addEventListener('click', loadReeferData);
            }
            callback();
        },
        focus: function (api, state) {
            if (state.device && state.device.id) {
                currentDeviceId = state.device.id;
                loadReeferData();
            } else {
                setupWebDeviceSelector();
            }
            if (!refreshIntervalId) {
                refreshIntervalId = setInterval(loadReeferData, 60000);
            }
        },
        blur: function (api, state) {
            if (refreshIntervalId) clearInterval(refreshIntervalId);
            if (myChartInstance) myChartInstance.destroy();
            if (elResultsPanel) elResultsPanel.innerHTML = "";
        }
    };
};
