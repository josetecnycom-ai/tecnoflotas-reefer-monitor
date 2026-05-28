/**
 * Add-in de Monitorización de Frigoríficos con Gráfica Histórica - Tecnoflotas
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

    // Diagnósticos obligatorios que SIEMPRE se muestran (aunque no tengan datos)
    const ALWAYS_VISIBLE = [
        "DiagnosticRefrigerationUnitSetTemperatureZone1Id",
        "DiagnosticRefrigerationUnitSetTemperatureZone2Id",
        "DiagnosticRefrigerationUnitStatusId",
        "DiagnosticRefrigerationUnitTotalNumberAlarmsId"
    ];

    let elResultsPanel;
    let refreshIntervalId = null;
    let myChartInstance = null;

    function loadReeferData() {
        if (!state.device || !state.device.id) {
            elResultsPanel.innerHTML = "<p class='error-msg'>No se ha detectado ningún vehículo seleccionado.</p>";
            return;
        }

        const calls = Object.keys(DIAGNOSTICS_MAP).map(diagnosticId => {
            return [
                "Get",
                {
                    typeName: "StatusData",
                    search: {
                        deviceSearch: { id: state.device.id },
                        diagnosticSearch: { id: diagnosticId },
                        fromDate: new Date(new Date() - 86400000).toISOString() // Últimas 24 horas completas
                    }
                }
            ];
        });

        api.multiCall(calls, function (results) {
            let htmlTable = '<table class="reefer-table"><thead><tr><th>Indicador</th><th>Valor Actual</th></tr></thead><tbody>';
            let chartDatasets = [];
            
            // Colores para las líneas de la gráfica basados en tu muestra
            const colorPalette = {
                "DiagnosticThermographTemperature1Id": "#3b82f6", // Azul
                "DiagnosticThermographTemperature2Id": "#f97316", // Naranja
                "DiagnosticCargoTemperatureZone1Id": "#10b981",   // Verde
                "DiagnosticCargoTemperatureZone2Id": "#ef4444"    // Rojo
            };

            Object.keys(DIAGNOSTICS_MAP).forEach((diagnosticId, index) => {
                const label = DIAGNOSTICS_MAP[diagnosticId];
                const dataBlock = results[index] || [];
                const hasData = dataBlock.length > 0;

                // 1. CONDICIONAL DE VISIBILIDAD: Si no hay datos y no es obligatorio, saltar fila
                if (!hasData && !ALWAYS_VISIBLE.includes(diagnosticId)) {
                    return; 
                }

                // Obtener el valor más reciente (último elemento del array devuelto)
                let displayValue = "<span class='no-data'>Sin datos</span>";
                if (hasData) {
                    let latestRecord = dataBlock[dataBlock.length - 1];
                    displayValue = diagnosticId.includes("Temperature") ? `${parseFloat(latestRecord.data).toFixed(1)} ºC` : latestRecord.data;
                }

                htmlTable += `<tr><td><strong>${label}</strong></td><td>${displayValue}</td></tr>`;

                // 2. PREPARAR DATOS PARA LA GRÁFICA (Solo las variables de temperatura)
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
                        tension: 0.3 // Curvatura suave idéntica a la imagen de referencia
                    });
                }
            });

            htmlTable += '</tbody></table>';
            elResultsPanel.innerHTML = htmlTable;

            // 3. RENDERIZAR O ACTUALIZAR LA GRÁFICA
            renderChart(chartDatasets);

        }, function (error) {
            console.error("Error en la carga de datos:", error);
        });
    }

    function renderChart(datasets) {
        const ctx = document.getElementById('reeferChart').getContext('2d');
        
        if (myChartInstance) {
            myChartInstance.destroy(); // Limpiar instancia previa antes de redibujar
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
                        grid: { color: '#e5e7eb' },
                        title: { display: true, text: 'Hora del registro', color: '#64748b' }
                    },
                    y: {
                        grid: { color: '#e5e7eb' },
                        title: { display: true, text: 'Temperatura (ºC)', color: '#64748b' }
                    }
                },
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } }
                }
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
            // Carga inicial inmediata al entrar
            loadReeferData();

            // AUTOMATIZACIÓN: Configurar intervalo de refresco cada 60 segundos (60000 ms)
            if (!refreshIntervalId) {
                refreshIntervalId = setInterval(function () {
                    loadReeferData();
                }, 60000);
            }
        },

        blur: function (api, state) {
            // CONTROL DE CONSUMO: Frenar actualización cuando el conductor sale del módulo
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
