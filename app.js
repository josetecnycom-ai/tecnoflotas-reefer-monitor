/**
 * Add-in de Monitorización de Frigoríficos Híbrido - Tecnoflotas
 * Versión corregida con los IDs nativos de cadena de frío oficiales de Geotab
 */
geotab.addin.reeferMonitor = function (api, state) {
    
    // Mapeo idéntico a los identificadores nativos de tu entorno Geotab
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

    // Parámetros de control que mostraremos en la tabla aunque no traigan registros históricos
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
                    if (activeAttachment.trailer.device && activeAttachment.trailer.device.id) {
                        targetFetchId = activeAttachment.trailer.device.id;
                    } else {
                        targetFetchId = activeAttachment.trailer.id;
                    }
                }
            }

            fetchTelemetryData(targetFetchId);

        }, function (error) {
            console.warn("Aviso: No se pudo verificar TrailerAttachment, usando dispositivo directo:", currentDeviceId);
            fetchTelemetryData(currentDeviceId);
        });
    }

    function fetchTelemetryData(assetId) {
        // Construimos el array de llamadas multicall de forma limpia
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
                "DiagnosticCargoTemperatureZone1Id": "#10b981", // Verde
                "DiagnosticCargoTemperatureZone2Id": "#ef4444", // Rojo
                "DiagnosticCargoTemperatureZone3Id": "#3b82f6", // Azul
                "RefrigerationUnitDischargeTemperatureZone1Id": "#f59e0b" // Ámbar
            };

            Object.keys(DIAGNOSTICS_MAP).forEach((diagnosticId, index) => {
                const label = DIAGNOSTICS_MAP[diagnosticId];
                const dataBlock = results[index] || [];
                const hasData = dataBlock.length > 0;

                // Ocultamos de la tabla los que no tengan datos, salvo las configuraciones base
                if (!hasData && !ALWAYS_VISIBLE.includes(diagnosticId)) {
                    return; 
                }

                let displayValue = "<span class='no-data'>Sin datos</span>";
                if (hasData) {
                    let latestRecord = dataBlock[dataBlock.length - 1];
                    // Si el identificador contiene la palabra "temperature", le damos formato de grados
                    displayValue = diagnosticId.toLowerCase().includes("temperature") 
                        ? `${parseFloat(latestRecord.data).toFixed(1)} ºC` 
                        : latestRecord.data;
                }

                htmlTable += `<tr><td><strong>${label}</strong></td><td>${displayValue}</td></tr>`;

                // Añadimos al gráfico si es una temperatura de carga válida
                if (hasData && diagnosticId.toLowerCase().includes("temperature") && colorPalette[diagnosticId]) {
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
            console.error("Error crítico en el multiCall de telemetría:", error);
            elResultsPanel.innerHTML = `<p class='error-msg'>Error al procesar la telemetría del activo seleccionado.</p>`;
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
                        type: 'time',
                        time: {
                            unit: 'hour',
                            displayFormats: { hour: 'HH:mm' }
                        },
                        grid: { color: '#e5e7eb' }
                    },
                    y: { grid: { color: '#e5e7eb' } }
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
            console.error("Error al listar vehículos en selector Web:", err);
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
