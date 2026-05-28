/**
 * Add-in de Monitorización de Frigoríficos - Tecnoflotas
 * Versión de depuración directa al Device ID
 */
geotab.addin.reeferMonitor = function (api, state) {
    
    const DIAGNOSTICS_MAP = {
        "ThermographTemperature2Id": "Temperatura Termógrafo 2",
        "DiagnosticCargoTemperatureZone2Id": "Temp. Carga Zona 2 (Estándar)",
        "a6WvyJrvcnUyjhidqtNqaTw": "Sonda Temp / Dato 1 (a6Wv)",
        "aZ_PCPTFQJUWGgwTodd5nhA": "Sonda Temp / Dato 2 (aZ_P)",
        "aIcfQOux4g0OsCc6co8cFAg": "Sonda Temp / Dato 3 (aIcf)",
        "aDD5B_jWgp0yi_HX_ma-7rg": "Sonda Temp / Dato 4 (aDD5)",
        "DiagnosticBluetoothBeaconBatteryLevelId": "Batería Beacon BLE",
        "DiagnosticAux1Id": "Entrada Auxiliar 1",
        "DiagnosticIgnitionId": "Contacto (Ignición)",
        "DiagnosticOdometerId": "Odómetro"
    };

    const ALWAYS_VISIBLE = [
        "ThermographTemperature2Id",
        "DiagnosticCargoTemperatureZone2Id",
        "a6WvyJrvcnUyjhidqtNqaTw",
        "aZ_PCPTFQJUWGgwTodd5nhA",
        "aIcfQOux4g0OsCc6co8cFAg",
        "aDD5B_jWgp0yi_HX_ma-7rg"
    ];

    let elResultsPanel;
    let refreshIntervalId = null;
    let myChartInstance = null;
    let currentDeviceId = null; 

    function loadReeferData() {
        if (!currentDeviceId) {
            elResultsPanel.innerHTML = "<p class='error-msg'>Por favor, seleccione un vehículo.</p>";
            return;
        }

        // CHIVATO 1: Ver qué ID exacto está usando el Add-in
        console.log("🚀 Pidiendo datos a Geotab para el dispositivo ID:", currentDeviceId);
        
        // Eliminada la lógica de TrailerAttachment. Vamos directos a consultar el ID.
        fetchTelemetryData(currentDeviceId);
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
                        // Ampliado a 48 horas por si acaso los datos son de ayer
                        fromDate: new Date(new Date() - 172800000).toISOString() 
                    }
                }
            ];
        });

        api.multiCall(calls, function (results) {
            // CHIVATO 2: Ver exactamente qué responde Geotab
            console.log("📦 Respuesta cruda de Geotab para ID " + assetId + ":", results);
            
            let htmlTable = '<table class="reefer-table"><thead><tr><th>Indicador</th><th>Valor Actual</th></tr></thead><tbody>';
            let chartDatasets = [];
            
            const colorPalette = {
                "ThermographTemperature2Id": "#ef4444",      
                "DiagnosticCargoTemperatureZone2Id": "#10b981", 
                "a6WvyJrvcnUyjhidqtNqaTw": "#3b82f6",           
                "aZ_PCPTFQJUWGgwTodd5nhA": "#f59e0b",           
                "aIcfQOux4g0OsCc6co8cFAg": "#8b5cf6",           
                "aDD5B_jWgp0yi_HX_ma-7rg": "#ec4899"            
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
                    displayValue = (diagnosticId.toLowerCase().includes("temperature") || diagnosticId.startsWith("a"))
                        ? `${parseFloat(latestRecord.data).toFixed(1)} ºC` 
                        : parseFloat(latestRecord.data).toFixed(0);
                }

                htmlTable += `<tr><td><strong>${label}</strong></td><td>${displayValue}</td></tr>`;

                if (hasData && colorPalette[diagnosticId]) {
                    const points = dataBlock.map(record => ({
                        x: new Date(record.dateTime).getTime(), 
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
            elResultsPanel.innerHTML = htmlTable;

            renderChart(chartDatasets);

        }, function (error) {
            console.error("❌ Error en multiCall:", error);
            elResultsPanel.innerHTML = `<p class='error-msg'>Error al procesar la telemetría.</p>`;
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
                        type: 'linear',
                        ticks: {
                            callback: function(value) {
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
