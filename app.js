geotab.addin.reeferMonitor = function (api, state) {
    let elResultsPanel = document.getElementById('results-panel');
    let inputSearch = document.getElementById('deviceSearch');
    let dataList = document.getElementById('devicesList');
    let chartInstance = null;
    let deviceMap = {}; // Para guardar { "Nombre": "ID" }

    function updateChart(dataPoints) {
        const ctx = document.getElementById('reeferChart').getContext('2d');
        
        if (chartInstance) chartInstance.destroy(); // Destruir gráfico anterior si existe

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Temperatura (ºC)',
                    data: dataPoints,
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1
                }]
            },
            options: {
                scales: {
                    x: { type: 'time', time: { unit: 'minute' } }
                }
            }
        });
    }

    function loadReeferData(deviceId) {
        // Ejemplo de consulta de datos históricos (ajusta tus diagnósticos aquí)
        api.call("Get", {
            typeName: "StatusData",
            search: {
                deviceSearch: { id: deviceId },
                diagnosticSearch: { id: "a6WvyJrvcnUyjhidqtNqaTw" }, // Ajusta según tu ID
                fromDate: new Date(new Date().getTime() - (2 * 60 * 60 * 1000)).toISOString()
            }
        }, function(results) {
            // Formatear para Chart.js
            const chartData = results.map(r => ({ x: r.dateTime, y: r.data }));
            updateChart(chartData);
            elResultsPanel.innerHTML = `Datos cargados: ${results.length} puntos.`;
        });
    }

    return {
        initialize: function (api, state, callback) {
            api.call("Get", { typeName: "Device" }, function (devices) {
                // Llenar el datalist
                devices.forEach(d => {
                    if (d.name) {
                        let option = document.createElement('option');
                        option.value = d.name;
                        option.dataset.id = d.id;
                        dataList.appendChild(option);
                        deviceMap[d.name] = d.id;
                    }
                });

                // Detectar selección
                inputSearch.onchange = function() {
                    const selectedId = deviceMap[this.value];
                    if (selectedId) loadReeferData(selectedId);
                };
            });
            callback();
        }
    };
};
