/**
 * Add-in de Monitorización de Frigoríficos
 */
geotab.addin.reeferMonitor = function (api, state) {
    // Tus IDs de diagnóstico
    const DIAGNOSTICS = [
        "DiagnosticThermographTemperature1Id",
        "DiagnosticThermographTemperature2Id",
        "DiagnosticRefrigerationUnitSetTemperatureZone1Id",
        "DiagnosticRefrigerationUnitSetTemperatureZone2Id",
        "DiagnosticRefrigerationUnitTemperatureZone1Id",
        "DiagnosticRefrigerationUnitTemperatureZone2Id",
        "DiagnosticRefrigerationUnitStatusId",
        "DiagnosticRefrigerationUnitTotalNumberAlarmsId"
    ];

    let elResultsPanel;
    let elFetchButton;

    return {
        /**
         * initialize() se ejecuta una vez cuando el Add-in se carga por primera vez.
         */
        initialize: function (api, state, callback) {
            elResultsPanel = document.getElementById('results-panel');
            elFetchButton = document.getElementById('btn-fetch-data');

            // Asignar eventos
            elFetchButton.addEventListener('click', () => {
                elResultsPanel.innerHTML = "<p>Cargando datos...</p>";
                
                // Ejemplo de llamada para obtener el último dato de un dispositivo y un diagnóstico
                // Sustituye 'b1' por el ID real del dispositivo (state.device.id si es un addin de dispositivo)
                api.call("Get", {
                    typeName: "StatusData",
                    search: {
                        diagnosticSearch: { id: DIAGNOSTICS[0] }, // Empezando por ThermographTemperature1Id
                        fromDate: new Date(new Date() - 86400000).toISOString(), // Últimas 24h
                        toDate: new Date().toISOString()
                    },
                    resultsLimit: 1
                }, function (result) {
                    if(result && result.length > 0) {
                        elResultsPanel.innerHTML = `<p><strong>Temperatura 1:</strong> ${result[0].data} ºC</p>`;
                    } else {
                        elResultsPanel.innerHTML = "<p>No hay datos recientes para este diagnóstico.</p>";
                    }
                }, function (e) {
                    console.error("Error al consultar la API:", e);
                });
            });

            callback();
        },

        /**
         * focus() se ejecuta cada vez que el usuario navega a la pestaña del Add-in.
         */
        focus: function (api, state) {
            // Lógica al mostrar la vista (ej. recargar la página según el dispositivo seleccionado)
        },

        /**
         * blur() se ejecuta cuando el usuario abandona la pestaña.
         */
        blur: function (api, state) {
            // Limpiar intervalos o variables si es necesario
        }
    };
};