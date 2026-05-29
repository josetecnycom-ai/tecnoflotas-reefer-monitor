geotab.addin.reeferMonitor = function (outerApi, outerState) {

    const DIAG_CONFIG = {
        "RefrigerationUnitSetTemperatureZone1Id":       { label: "Set Point Zona 1",   type: "temp",   force: true  },
        "RefrigerationUnitSetTemperatureZone2Id":       { label: "Set Point Zona 2",   type: "temp",   force: true  },
        "RefrigerationUnitStatusId":                    { label: "Estado de la unidad",type: "status", force: true  },
        "DiagnosticCargoTemperatureZone1Id":            { label: "Temp. Carga Zona 1", type: "temp",   force: false },
        "DiagnosticCargoTemperatureZone2Id":            { label: "Temp. Carga Zona 2", type: "temp",   force: false },
        "DiagnosticCargoTemperatureZone3Id":            { label: "Temp. Carga Zona 3", type: "temp",   force: false },
        "RefrigerationUnitSetTemperatureZone3Id":       { label: "Set Point Zona 3",   type: "temp",   force: false },
        "RefrigerationUnitDischargeTemperatureZone1Id": { label: "Descarga Zona 1",    type: "temp",   force: false },
        "RefrigerationUnitDischargeTemperatureZone2Id": { label: "Descarga Zona 2",    type: "temp",   force: false },
        "RefrigerationUnitDischargeTemperatureZone3Id": { label: "Descarga Zona 3",    type: "temp",   force: false },
        "DiagnosticDoor1StatusId":                      { label: "Puerta 1",           type: "door",   force: false },
        "DiagnosticDoor2StatusId":                      { label: "Puerta 2",           type: "door",   force: false }
    };

    const CHART_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
    const PLACEHOLDER_IDS = new Set(['b2', 'b1', '0', '']);

    // ─── Estado interno ────────────────────────────────────────────────────────
    let currentApi        = outerApi; 
    let refreshInterval   = null;
    let loadRetryTimeout  = null;
    let loadRetryCount    = 0;
    const MAX_RETRIES     = 2; // Rápido fallback al modo dinámico si falla
    let chartInstance     = null;
    let deviceMap         = {};
    let currentDeviceId   = null;
    let listenersAttached = false;
    let fallbackMode      = false; 

    // ─── Referencias DOM ───────────────────────────────────────────────────────
    const inputSearch = document.getElementById('deviceSearch');
    const dataList    = document.getElementById('devicesList');
    const btnRefresh  = document.getElementById('btn-fetch-data');
    const panel       = document.getElementById('results-panel');

    // ─── Utilidades de UI ──────────────────────────────────────────────────────

    function showInfo(msg) {
        if (panel) panel.innerHTML = '<p style="padding:15px; color:#64748b;">' + msg + '</p>';
    }

    function showError(title, message, btnLabel, btnAction) {
        if (!panel) return;
        var actionBtn = btnLabel
            ? '<br><br><button onclick="window.__reeferAction && window.__reeferAction()"' +
              ' style="margin-top:10px; padding:8px 20px; background:#2563eb; color:#fff;' +
              ' border:none; border-radius:4px; cursor:pointer; font-size:14px;">' +
              btnLabel + '</button>'
            : '';
        panel.innerHTML =
            '<div style="padding:15px; background:#fee2e2; color:#b91c1c;' +
            ' border-radius:4px; border:1px solid #f87171; margin-top:15px;">' +
            '<strong style="font-size:16px;">' + title + '</strong><br><br>' +
            message + actionBtn + '</div>';
        if (typeof btnAction === 'function') {
            window.__reeferAction = btnAction;
        }
    }

    function isNetworkError(error) {
        if (!error) return false;
        var t = (error.data && error.data.type) || '';
        return t === 'NetworkError' || t === 'network';
    }

    function cancelPendingRetries() {
        if (loadRetryTimeout) { clearTimeout(loadRetryTimeout); loadRetryTimeout = null; }
        loadRetryCount = 0;
    }

    // ─── Carga de la lista de dispositivos (Autocomplete Masivo) ───────────────

    function loadDeviceList() {
        if (fallbackMode) return;

        if (inputSearch && loadRetryCount === 0) {
            inputSearch.placeholder = 'Cargando vehículos...';
        }

        currentApi.call('Get', { typeName: 'Device', resultsLimit: 5000 }, function(devices) {
            cancelPendingRetries();
            if (inputSearch) inputSearch.disabled = false;

            devices.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
            deviceMap = {};
            if (dataList) dataList.innerHTML = '';
            
            devices.forEach(function(d) {
                if (d.name) {
                    var option = document.createElement('option');
                    option.value = d.name;
                    if (dataList) dataList.appendChild(option);
                    deviceMap[d.name.trim().toUpperCase()] = d.id;
                }
            });

            if (inputSearch) {
                inputSearch.placeholder = 'Escribe o selecciona una unidad...';
                if (currentDeviceId && !inputSearch.value) {
                    var devName = Object.keys(deviceMap).find(function(k) { return deviceMap[k] === currentDeviceId; });
                    if (devName) inputSearch.value = devName;
                }
            }
            console.log('[reeferMonitor] Flota cargada masivamente: ' + devices.length + ' activos.');

        }, function(error) {
            console.warn('[reeferMonitor] Fallo carga masiva de flota. Pasando a Autocompletado Dinámico.', error);

            if (isNetworkError(error) || (error && error.code === 400)) {
                if (loadRetryCount < MAX_RETRIES) {
                    loadRetryCount++;
                    loadRetryTimeout = setTimeout(loadDeviceList, 2000);
                } else {
                    enableFallbackMode();
                }
            } else {
                enableFallbackMode();
            }
        });
    }

    function enableFallbackMode() {
        fallbackMode = true;
        cancelPendingRetries();
        if (inputSearch) {
            inputSearch.placeholder = 'Escribe para buscar (ej: C54)...';
            inputSearch.disabled = false;
        }
    }

    // ─── Carga dinámica de un solo vehículo (Fallback) ─────────────────────────
    
    function fetchAndLoadSingleDevice(nameStr) {
        showInfo('Buscando vehículo "' + nameStr + '"...');
        currentApi.call('Get', {
            typeName: 'Device',
            search: { name: "%" + nameStr + "%" }
        }, function(devices) {
            if (devices && devices.length > 0) {
                var match = devices.find(function(d) { return d.name && d.name.toUpperCase() === nameStr; }) || devices[0];
                deviceMap[match.name.trim().toUpperCase()] = match.id;
                if (inputSearch) inputSearch.value = match.name;
                loadReeferData(match.id);
            } else {
                showError('Vehículo no encontrado', 'No existe ningún vehículo que coincida con "' + nameStr + '".');
            }
        }, function(error) {
            console.error('[reeferMonitor] Error buscando vehículo individual:', error);
            showError('Error de red', 'No se pudo buscar el vehículo. Por favor, reintenta.');
        });
    }

    // ─── Carga de datos de telemetría ──────────────────────────────────────────

    function loadReeferData(deviceId) {
        if (!deviceId || PLACEHOLDER_IDS.has(deviceId)) return;
        currentDeviceId = deviceId;

        showInfo('Obteniendo telemetría del vehículo...');

        var fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        var diagKeys = Object.keys(DIAG_CONFIG);

        var calls = diagKeys.map(function(id) {
            return ['Get', {
                typeName: 'StatusData',
                search: {
                    deviceSearch: { id: deviceId },
                    diagnosticSearch: { id: id },
                    fromDate: fromDate
                }
            }];
        });
        calls.push(['Get', {
            typeName: 'FaultData',
            search: { deviceSearch: { id: deviceId }, fromDate: fromDate }
        }]);

        currentApi.multiCall(calls, function(results) {
            var faultsData    = results.pop();
            var telemetryData = results;
            renderTable(telemetryData, diagKeys, faultsData.length);
            renderChart(telemetryData, diagKeys);
        }, function(error) {
            console.error('[reeferMonitor] Error telemetría:', error && error.code, error);
            window.__reeferAction = function() {
                loadReeferData(currentDeviceId);
            };
            showError('Error al cargar datos',
                'No se pudieron obtener los datos del vehículo. Puede ser un error de conexión.',
                '🔄 Reintentar', window.__reeferAction);
        });
    }

    // ─── Render: tabla ─────────────────────────────────────────────────────────

    function renderTable(telemetryData, diagKeys, totalAlerts) {
        var html = '<table style="width:100%; border-collapse:collapse; margin-top:15px; font-family:sans-serif;">';
        html += '<tr style="background:#f3f4f6; border-bottom:2px solid #cbd5e1;">' +
                '<th style="text-align:left; padding:12px;">Medición</th>' +
                '<th style="text-align:right; padding:12px;">Valor / Validez</th></tr>';

        telemetryData.forEach(function(data, index) {
            var key     = diagKeys[index];
            var cfg     = DIAG_CONFIG[key];
            var hasData = data && data.length > 0;

            if (cfg.force || hasData) {
                var displayValue    = '---';
                var timeWarningHtml = '';

                if (hasData) {
                    var lastRecord  = data[data.length - 1];
                    var rawVal      = lastRecord.data;
                    displayValue    = cfg.type === 'temp' ? rawVal.toFixed(1) + ' ºC' : rawVal;
                    var recordTime  = new Date(lastRecord.dateTime);
                    var diffMinutes = Math.floor((Date.now() - recordTime) / 60000);

                    if (diffMinutes <= 15) {
                        timeWarningHtml = '<span style="display:block; font-size:11px; color:#16a34a;">✔ Tiempo real</span>';
                    } else if (diffMinutes < 60) {
                        timeWarningHtml = '<span style="display:block; font-size:11px; color:#d97706; font-weight:bold;">⚠ Hace ' + diffMinutes + ' min</span>';
                    } else {
                        var diffHours     = Math.floor(diffMinutes / 60);
                        var formattedTime = recordTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        timeWarningHtml   = '<span style="display:block; font-size:11px; color:#dc2626; font-weight:bold;">❌ Desconectado (Hora: ' + formattedTime + ' - Hace ' + diffHours + 'h)</span>';
                    }
                } else if (cfg.force) {
                    timeWarningHtml = '<span style="display:block; font-size:11px; color:#94a3b8;">Sin registros</span>';
                }

                html += '<tr style="border-bottom:1px solid #e2e8f0;">' +
                        '<td style="padding:12px; font-weight:500; color:#1e293b;">' + cfg.label + '</td>' +
                        '<td style="padding:12px; text-align:right; font-weight:bold; color:#0f172a;">' +
                        displayValue + ' ' + timeWarningHtml + '</td></tr>';
            }
        });

        html += '<tr style="border-bottom:1px solid #e2e8f0; background:#fff1f2;">' +
                '<td style="padding:12px; color:#be123c; font-weight:bold;">Total Alertas Activas (24h)</td>' +
                '<td style="padding:12px; text-align:right; font-weight:bold; color:#be123c;">' + totalAlerts + '</td></tr>';
        html += '</table>';
        if (panel) panel.innerHTML = html;
    }

    // ─── Render: gráfica ────────────────────────────────────────────────────────

    function renderChart(telemetryData, diagKeys) {
        var ctx      = document.getElementById('reeferChart').getContext('2d');
        var datasets = [];
        var colorIdx = 0;
        var now        = new Date();
        var limitsFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        telemetryData.forEach(function(data, index) {
            var key = diagKeys[index];
            var cfg = DIAG_CONFIG[key];
            if (data && data.length > 0 && cfg.type === 'temp') {
                datasets.push({
                    label:            cfg.label,
                    data:             data.map(function(d) { return { x: new Date(d.dateTime), y: d.data }; }),
                    borderColor:      CHART_COLORS[colorIdx % CHART_COLORS.length],
                    backgroundColor:  'transparent',
                    borderWidth:      2.5,
                    pointRadius:      1,
                    pointHoverRadius: 5,
                    tension:          0.1
                });
                colorIdx++;
            }
        });

        if (chartInstance) chartInstance.destroy();

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: { datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'time',
                        min: limitsFrom,
                        max: now,
                        time: {
                            unit: 'hour', stepSize: 2,
                            displayFormats: { hour: 'HH:mm' },
                            tooltipFormat:  'dd/MM HH:mm'
                        },
                        grid:  { color: '#f1f5f9' },
                        title: { display: true, text: 'Línea de tiempo (Últimas 24 Horas)', color: '#64748b' }
                    },
                    y: {
                        grid:  { color: '#e2e8f0' },
                        title: { display: true, text: 'Temperatura (ºC)', color: '#64748b' }
                    }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
                }
            }
        });
    }

    // ─── Ciclo de vida del add-in ──────────────────────────────────────────────

    return {

        initialize: function (api, state, callback) {
            currentApi = api; 
            
            if (!listenersAttached) {
                listenersAttached = true;
                let debounceTimer = null;

                if (inputSearch) {
                    inputSearch.addEventListener('input', function() {
                        var name = this.value ? this.value.trim().toUpperCase() : '';
                        
                        // 1. Si ya tenemos el ID exacto, cargar automáticamente
                        var id = deviceMap[name];
                        if (id) {
                            loadReeferData(id);
                            return;
                        }

                        // 2. Autocompletado Dinámico para la App Móvil
                        // Si falla la carga masiva, buscaremos en el servidor a medida que escribe
                        if (fallbackMode && name.length >= 2) {
                            if (debounceTimer) clearTimeout(debounceTimer);
                            debounceTimer = setTimeout(function() {
                                currentApi.call('Get', {
                                    typeName: 'Device',
                                    search: { name: "%" + name + "%" }
                                }, function(devices) {
                                    if (!devices || devices.length === 0) return;
                                    
                                    // Limpiar y rellenar el datalist para que aparezca el menú desplegable
                                    if (dataList) dataList.innerHTML = '';
                                    devices.forEach(function(d) {
                                        if (d.name) {
                                            var option = document.createElement('option');
                                            option.value = d.name;
                                            if (dataList) dataList.appendChild(option);
                                            deviceMap[d.name.trim().toUpperCase()] = d.id;
                                        }
                                    });
                                }, function(err) {
                                    console.warn('[reeferMonitor] Error autocompletado dinámico', err);
                                });
                            }, 500); // Esperar medio segundo a que termine de teclear
                        }
                    });
                }

                if (btnRefresh) {
                    btnRefresh.addEventListener('click', function() {
                        var name = inputSearch ? inputSearch.value.trim().toUpperCase() : '';
                        
                        if (deviceMap[name]) {
                            loadReeferData(deviceMap[name]);
                        } else if (name !== '') {
                            fetchAndLoadSingleDevice(name);
                        } else if (currentDeviceId) {
                            loadReeferData(currentDeviceId);
                        } else {
                            showError(
                                'Vehículo no seleccionado',
                                'Por favor, escribe el nombre de un vehículo para buscarlo.'
                            );
                        }
                    });
                }
            }
            callback();
        },

        focus: function (api, state) {
            if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }

            if (state && state.device) {
                var devId = typeof state.device === 'string'
                    ? state.device
                    : (state.device.id || state.device.Id || null);

                if (devId && !PLACEHOLDER_IDS.has(devId)) {
                    currentDeviceId = devId;
                }
            }

            if (currentDeviceId) {
                loadReeferData(currentDeviceId);
                refreshInterval = setInterval(function() {
                    if (currentDeviceId) loadReeferData(currentDeviceId);
                }, 60000);
            }

            // Intento de carga masiva para el navegador
            loadDeviceList();
        },

        blur: function () {
            if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
        }
    };
};
