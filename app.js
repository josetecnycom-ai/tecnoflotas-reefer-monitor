/**
 * Add-in de Monitorización de Frigoríficos Híbrido - Tecnoflotas
 * Versión corregida contra errores 400 de validación de API
 */
geotab.addin.reeferMonitor = function (api, state) {
    
    // Diccionario con los IDs de sistema oficiales del SDK de Geotab
    const DIAGNOSTICS_MAP = {
        "DiagnosticBluetoothThermographTemperature1Id": "Termógrafo - Temperatura 1",
        "DiagnosticBluetoothThermographTemperature2Id": "Termógrafo - Temperatura 2",
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
    let currentDeviceId = null; 

    function loadReeferData() {
        if (!currentDeviceId) {
            elResultsPanel.innerHTML = "<p class='error-msg'>Por favor, seleccione o vincule un vehículo válido.</p>";
            return;
        }

        // Consultamos el acoplamiento de remolques de forma segura
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
                    // Si el remolque tiene un localizador asignado, usamos su ID de dispositivo
                    if (activeAttachment.trailer.device && activeAttachment.trailer.device.id) {
                        targetFetchId = activeAttachment.trailer.device.id;
                    } else {
                        targetFetchId = activeAttachment.trailer.id;
                    }
                }
            }

            // Ejecutamos la telemetría con el ID resultante
            fetchTelemetryData(targetFetchId);

        }, function (error) {
            // CONTROL DE ERROR PASO 1: Si falla TrailerAttachment (Error 400), continuamos con el ID principal
            console.warn("Aviso: No se pudo verificar TrailerAttachment, usando dispositivo directo:", currentDeviceId);
            fetchTelemetryData(currentDeviceId);
        });
    }

    function fetchTelemetryData(assetId) {
        // Construimos el multicall asegurando que no vayan parámetros vacíos
        const calls = Object.keys(DIAGNOSTICS_MAP).map(diagnosticId => {
            return [
                "Get",
                {
                    typeName: "StatusData",
                    search: {
                        deviceSearch: { id: assetId },
                        diagnosticSearch: { id: diagnosticId },
                        fromDate: new Date(new Date() - 86400000).toISOString() // Últimas 24h
                    }
                }
            ];
        });

        api.multiCall(calls, function (results) {
            let htmlTable = '<table class="reefer-table"><thead><tr><th>Indicador</th><th>Valor Actual</th></tr></thead><tbody>';
            let chartDatasets = [];
            
            const colorPalette = {
                "DiagnosticBluetoothThermographTemperature1Id": "#3b82f6", 
                "DiagnosticBluetoothThermographTemperature2Id": "#f97316", 
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
            console.error("Error crítico en el multiCall de telemetría:", error);
            elResultsPanel.innerHTML = `<p class='error-msg'>Error al obtener registros de este activo (Verifica los IDs de diagnóstico en este entorno).</p>`;
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
