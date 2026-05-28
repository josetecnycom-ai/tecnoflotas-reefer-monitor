geotab.addin.reeferMonitor = function (api, state) {
    const DIAGNOSTICS_MAP = {
        "ThermographTemperature2Id": "Temperatura Termógrafo 2",
        "DiagnosticCargoTemperatureZone2Id": "Temp. Carga Zona 2",
        "a6WvyJrvcnUyjhidqtNqaTw": "Sonda Temp 1",
        "aZ_PCPTFQJUWGgwTodd5nhA": "Sonda Temp 2"
    };

    let elResultsPanel = document.getElementById('results-panel');

    function loadReeferData(deviceId) {
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
            let html = '<table style="width:100%; border-collapse: collapse;">';
            results.forEach((data, index) => {
                const name = Object.values(DIAGNOSTICS_MAP)[index];
                const value = (data.length > 0) ? data[data.length - 1].data + " ºC" : "Sin datos";
                html += `<tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px;">${name}</td><td style="padding: 8px;"><strong>${value}</strong></td></tr>`;
            });
            html += '</table>';
            elResultsPanel.innerHTML = html;
        });
    }

    function initSelector() {
        let selectEl = document.getElementById('deviceSelect');
        
        // Verificación de seguridad: si el HTML no existe, avisamos en consola y paramos
        if (!selectEl) {
            console.error("❌ ERROR: No se encuentra el elemento <select id='deviceSelect'> en tu index.html. Por favor, añádelo.");
            elResultsPanel.innerHTML = "<p style='color:red;'>Error de configuración: Falta el selector en index.html</p>";
            return;
        }

        api.call("Get", { typeName: "Device" }, function (devices) {
            // Ordenamos dispositivos para que sea más fácil encontrar el remolque
            devices.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
            
            selectEl.innerHTML = devices.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
            
            selectEl.onchange = function() {
                loadReeferData(this.value);
            };

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
        focus: function (api, state) {},
        blur: function () {}
    };
};
