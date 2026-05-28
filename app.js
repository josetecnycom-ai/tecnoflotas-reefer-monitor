geotab.addin.reeferMonitor = function (api, state) {
    const DIAGNOSTICS_MAP = {
        "ThermographTemperature2Id": "Temperatura Termógrafo 2",
        "DiagnosticCargoTemperatureZone2Id": "Temp. Carga Zona 2",
        "a6WvyJrvcnUyjhidqtNqaTw": "Sonda Temp 1",
        "aZ_PCPTFQJUWGgwTodd5nhA": "Sonda Temp 2"
    };

    let elResultsPanel = document.getElementById('results-panel');
    let inputSearch = document.getElementById('deviceSearch');
    let dataList = document.getElementById('devicesList');
    let chartInstance = null;
    let deviceMap = {};

    function updateChart(dataPoints) {
        const ctx = document.getElementById('reeferChart').getContext('2d');
        if (chartInstance) chartInstance.destroy();

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Sonda Temp 1 (ºC)',
                    data: dataPoints,
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                scales: { x: { type: 'time', time: { unit: 'minute' } } }
            }
        });
    }

    function renderTable(results) {
        let html = '<h3>Valores Actuales</h3><table border="1" style="width:100%; border-collapse: collapse;">';
        results.forEach((data, index) => {
            const diagId = Object.keys(DIAGNOSTICS_MAP)[index];
            const name = DIAGNOSTICS_MAP[diagId];
            // Tomamos el último valor registrado si existe
            const value = (data && data.length > 0) ? data[data.length - 1].data.toFixed(2) + " ºC" : "Sin datos";
            html += `<tr><td style="padding: 8px;">${name}</td><td style="padding: 8px;">${value}</td></tr>`;
        });
        html += '</table>';
        elResultsPanel.innerHTML = html;
    }

    function loadReeferData(deviceId) {
        const fromDate = new Date(new Date().getTime() - (2 * 60 * 60 * 1000)).toISOString();
        
        // Creamos las llamadas para todos los sensores
        const calls = Object.keys(DIAGNOSTICS_MAP).map(diagId => [
            "Get", {
                typeName: "StatusData",
                search: {
                    deviceSearch: { id: deviceId },
                    diagnosticSearch: { id: diagId },
                    fromDate: fromDate
                }
            }
        ]);

        api.multiCall(calls, function(results) {
            // 1. Actualizar la tabla con todos los resultados
            renderTable(results);

            // 2. Actualizar el gráfico (usamos el índice 2, que corresponde a 'a6WvyJrvcnUyjhidqtNqaTw')
            const chartData = results[2].map(r => ({ x: r.dateTime, y: r.data }));
            updateChart(chartData);
        });
    }

    return {
        initialize: function (api, state, callback) {
            api.call("Get", { typeName: "Device" }, function (devices) {
                devices.forEach(d => {
                    if (d.name) {
                        let option = document.createElement('option');
                        option.value = d.name;
                        dataList.appendChild(option);
                        deviceMap[d.name] = d.id;
                    }
                });
                inputSearch.onchange = function() {
                    if (deviceMap[this.value]) loadReeferData(deviceMap[this.value]);
                };
            });
            callback();
        }
    };
};
