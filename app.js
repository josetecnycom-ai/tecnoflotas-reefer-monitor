geotab.addin.reeferMonitor = function (api, state) {
    const DIAGNOSTICS_MAP = {
        "ThermographTemperature2Id": "Temperatura Termógrafo 2",
        "DiagnosticCargoTemperatureZone2Id": "Temp. Carga Zona 2",
        "a6WvyJrvcnUyjhidqtNqaTw": "Sonda Temp 1",
        "aZ_PCPTFQJUWGgwTodd5nhA": "Sonda Temp 2"
    };

    let elResultsPanel = document.getElementById('results-panel');
    let selectEl = document.getElementById('deviceSelect');
    let currentDeviceId = null;

    // Función para cargar los datos del dispositivo seleccionado
    function loadReeferData(deviceId) {
        currentDeviceId = deviceId;
        console.log("🚀 Consultando datos para:", deviceId);
        
        const calls = Object.keys(DIAGNOSTICS_MAP).map(diagId => [
            "Get", {
                typeName: "StatusData",
                search: {
                    deviceSearch: { id: deviceId },
                    diagnosticSearch: { id: diagId },
                    fromDate: new Date(new Date().getTime() - (24 * 60 * 60 * 1000)).toISOString()
                }
            }
        ]);

        api.multiCall(calls, function (results) {
            let html = '<table>';
            results.forEach((data, index) => {
                const name = Object.values(DIAGNOSTICS_MAP)[index];
                const value = (data.length > 0) ? data[data.length - 1].data + " ºC" : "Sin datos";
                html += `<tr><td>${name}</td><td><strong>${value}</strong></td></tr>`;
            });
            html += '</table>';
            elResultsPanel.innerHTML = html;
        });
    }

    // Inicializar el selector
    function initSelector() {
        api.call("Get", { typeName: "Device" }, function (devices) {
            selectEl.innerHTML = devices.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
            
            // Evento al cambiar de dispositivo
            selectEl.onchange = function() {
                loadReeferData(this.value);
            };

            // Cargar primero de la lista por defecto
            if (devices.length > 0) {
                loadReeferData(devices[0].id);
            }
        });
    }

    return {
        initialize: function (api, state, callback) {
            initSelector();
            callback();
        },
        focus: function (api, state) {
            // No hacemos nada automático aquí para evitar errores con el ID del mapa
        },
        blur: function () {}
    };
};
