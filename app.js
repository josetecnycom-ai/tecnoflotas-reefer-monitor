/**
 * Add-in de Monitorización de Frigoríficos - Tecnoflotas
 */
geotab.addin.reeferMonitor = function (api, state) {
    // Mapeo de IDs de Geotab a etiquetas legibles
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

    let elResultsPanel;
    let elFetchButton;

    // Función principal para obtener los datos en tiempo real
    function loadReeferData() {
        // En Geotab Drive, 'state.device' nos da automáticamente el vehículo seleccionado por el chofer
        if (!state.device || !state.device.id) {
            elResultsPanel.innerHTML = "<p class='error-msg'>No se ha detectado ningún vehículo seleccionado en Geotab Drive.</p>";
            return;
        }

        elResultsPanel.innerHTML = "<p class='loading-msg'>Buscando últimas mediciones...</p>";

        // Creamos la estructura del multiCall de forma dinámica
        const calls = Object.keys(DIAGNOSTICS_MAP).map(diagnosticId => {
            return [
                "Get",
                {
                    typeName: "StatusData",
                    search: {
                        deviceSearch: { id: state.device.id },
                        diagnosticSearch: { id: diagnosticId },
                        fromDate: new Date(new Date() - 86400000).toISOString() // Últimas 24 horas
                    },
                    resultsLimit: 1
                }
            ];
        });

        // Ejecución optimizada en un solo lote
        api.multiCall(calls, function (results) {
            let htmlTable = '<table class="reefer-table"><thead><tr><th>Indicador</th><th>Valor Actual</th></tr></thead><tbody>';
            
            Object.keys(DIAGNOSTICS_MAP).forEach((diagnosticId, index) => {
                const label = DIAGNOSTICS_MAP[diagnosticId];
                const dataBlock = results[index];
                let displayValue = "<span class='no-data'>Sin datos</span>";

                if (dataBlock && dataBlock.length > 0) {
                    let rawValue = dataBlock[0].data;
                    
                    // Formatear si es un diagnóstico de temperatura
                    if (diagnosticId.includes("Temperature")) {
                        displayValue = `${parseFloat(rawValue).toFixed(1)} ºC`;
                    } else {
                        displayValue = rawValue;
                    }
                }

                htmlTable += `<tr><td><strong>${label}</strong></td><td>${displayValue}</td></tr>`;
            });

            htmlTable += '</tbody></table>';
            elResultsPanel.innerHTML = htmlTable;

        }, function (error) {
            console.error("Error en multiCall:", error);
            elResultsPanel.innerHTML = `<p class='error-msg'>Error al conectar con la API: ${error}</p>`;
        });
    }

    return {
        /**
         * initialize() se ejecuta al arrancar la app en memoria.
         */
        initialize: function (api, state, callback) {
            elResultsPanel = document.getElementById('results-panel');
            elFetchButton = document.getElementById('btn-fetch-data');

            if (elFetchButton) {
                elFetchButton.textContent = "Actualizar Datos"; // Cambiado a modo "Refrescar"
                elFetchButton.addEventListener('click', () => {
                    loadReeferData();
                });
            }

            callback();
        },

        /**
         * focus() SE EJECUTA AUTOMÁTICAMENTE al entrar en la pestaña.
         */
        focus: function (api, state) {
            loadReeferData(); // Ejecución sin clicks
        },

        /**
         * blur() se ejecuta al salir del módulo.
         */
        blur: function (api, state) {
            // Se puede limpiar contenido para que no se quede congelado al cambiar de vehículo
            if(elResultsPanel) elResultsPanel.innerHTML = "";
        }
    };
};
