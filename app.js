/**
 * Add-in de Monitorización de Frigoríficos Híbrido con detección de Remolques - Tecnoflotas
 */
geotab.addin.reeferMonitor = function (api, state) {
    
    const DIAGNOSTICS_MAP = {
        "DiagnosticThermographTemperature1Id": "Termógrafo - Temperatura 1",
        "DiagnosticThermographTemperature2Id": "Termógrafo - Temperatura 2",
        "DiagnosticCargoTemperatureZone1Id": "Temperatura Carga Zona 1",
        "DiagnosticCargoTemperatureZone2Id": "Temperatura Carga Zona 2",
        "DiagnosticRefrigerationUnitTemperatureZone1Id": "Unidad Frío - Temp. Zona 1",
        "DiagnosticRefrigerationUnitTemperatureZone2Id": "Unidad Frío - Temp. Zona 2",
        "DiagnosticRefrigerationUnitSetTemperatureZone1Id": "Set Point Zona 1",
        "DiagnosticRefrigerationUnitSetTemperatureZone2Id": "Set Point Zona 2",
        "DiagnosticRefrigerationUnitStatusId": "Estado de la Unidad",
        "DiagnosticRefrigerationUnitTotalNumberAlarmsId": "Total Alertas Activas"
    };

    const ALWAYS_VISIBLE = [
        "DiagnosticRefrigerationUnitSetTemperatureZone1Id",
        "DiagnosticRefrigerationUnitSetTemperatureZone2Id",
        "DiagnosticRefrigerationUnitStatusId",
        "DiagnosticRefrigerationUnitTotalNumberAlarmsId"
    ];

    let elResultsPanel;
    let refreshIntervalId = null;
    let myChartInstance = null;
    let currentDeviceId = null; // ID de la cabeza tractora seleccionada

    function loadReeferData() {
        if (!currentDeviceId) {
            elResultsPanel.innerHTML = "<p class='error-msg'>Por favor, seleccione o vincule un vehículo válido.</p>";
            return;
        }

        // 1. PASO CLAVE: Buscar qué remolque está enganchado actualmente a este vehículo
        api.call("Get", {
            typeName: "TrailerAttachment",
            search: {
                deviceSearch: { id: currentDeviceId }
            }
        }, function (attachments) {
            let targetFetchId = currentDeviceId; // Por defecto, si no hay remolque, usamos el principal

            if (attachments && attachments.length > 0) {
                // Filtramos el enganche que esté activo hoy (sin fecha 'toDate' o con fecha futura)
                const now = new Date();
                const activeAttachment = attachments.find(a => !a.toDate || new Date(a.toDate) > now);
                
                if (activeAttachment && activeAttachment.trailer) {
                    targetFetchId = activeAttachment.trailer.id; // ¡Cambiamos el objetivo al ID del Remolque!
                }
            }

            // 2. Lanzamos la petición de telemetría usando el ID del activo correcto
            fetchTelemetryData(targetFetchId);

        }, function (error) {
            console.error("Error al consultar TrailerAttachment, intentando con vehículo principal:", error);
            fetchTelemetryData(currentDeviceId);
        });
    }

    // Ejecuta el multiCall y renderiza los componentes visuales
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
                "DiagnosticThermographTemperature1Id": "#3b82f6", 
                "DiagnosticThermographTemperature2Id": "#f97316", 
                "DiagnosticCargoTemperatureZone1Id": "#10b981",   
                "DiagnosticCargoTemperatureZone2Id": "#ef4444"    
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
                    displayValue = diagnosticId.includes("Temperature") ? `${parseFloat(latestRecord.data).toFixed(1)} ºC` : latestRecord.data;
                }

                htmlTable += `<tr><td><strong>${label}</strong></td><td>${displayValue}</td></tr>`;

                if (hasData && diagnosticId.includes("Temperature") && colorPalette[diagnosticId]) {
                    const points = dataBlock.map(record => ({
                        x: new Date(record.dateTime),
                        y: parseFloat(record.data)
                    }));

                    chartDatasets.push({
                        label: label,
                        data: points,
                        borderColor: colorPalette[diagnosticId],
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 1.5,
                        tension: 0.3
                    });
                }
            });

            htmlTable += '</tbody></table>';
            elResultsPanel.innerHTML = htmlTable;

            renderChart(chartDatasets);

        }, function (error) {
            console.error("Error en multiCall de telemetría:", error);
            elResultsPanel.innerHTML = `<p class='error-msg'>Error al obtener datos del dispositivo.</p>`;
        });
    }

    function renderChart(datasets) {
        const ctx = document.getElementById('reeferChart').getContext('2d');
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
                        type: 'time',
                        time: {
                            unit: 'hour',
                            displayFormats: { hour: 'HH:mm' }
                        },
                        grid: { color: '#e5e7eb' }
                    },
                    y: {
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

        api.call("Get", {
            typeName: "Device"
        }, function (devices) {
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
        }, function (err) {
            console.error("Error al listar vehículos en entorno web:", err);
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
            if (refreshIntervalId) {
                clearInterval(refreshIntervalId);
                refreshIntervalId = null;
            }
            if (myChartInstance) {
                myChartInstance.destroy();
                myChartInstance = null;
            }
            if (elResultsPanel) elResultsPanel.innerHTML = "";
        }
    };
};
