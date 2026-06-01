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
    const PLACEHOLDER_IDS = new Set(['0', '', 'NoDevice', 'Unknown', 'NoVehicle']);

    // ─── Estado interno ────────────────────────────────────────────────────────
    let currentApi        = outerApi; 
    let refreshInterval   = null;
    let isDriveApp        = false; 
    let chartInstance     = null;
    let deviceMap         = {};
    let currentDeviceId   = null;
    let listenersAttached = false;
    let fallbackMode      = false; 

    // ─── Bypassing Drive Proxy ─────────────────────────────────────────────────
    // El proxy interno de la App Drive (launcher.pack.js) bloquea muchas peticiones (como Get Device)
    // y falla si la App se queda en un estado inconsistente. Bypasseamos el proxy haciendo
    // peticiones HTTP directas al servidor de Geotab para garantizar que funcione siempre.

    function directCall(method, params, successCallback, errorCallback) {
        currentApi.getSession(function(credentials, server) {
            var url = 'https://' + (server || 'my.geotab.com') + '/apiv1';
            var payload = {
                method: method,
                params: Object.assign({}, params, { credentials: credentials })
            };
            
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function(res) { return res.json(); })
            .then(function(json) {
                if (json.error) {
                    if (errorCallback) errorCallback(json.error);
                } else {
                    if (successCallback) successCallback(json.result);
                }
            })
            .catch(function(err) {
                if (errorCallback) errorCallback(err);
            });
        });
    }

    function directMultiCall(callsArray, successCallback, errorCallback) {
        currentApi.getSession(function(credentials, server) {
            var url = 'https://' + (server || 'my.geotab.com') + '/apiv1';
            
            var payload = {
                method: "ExecuteMultiCall",
                params: {
                    calls: callsArray.map(function(call) {
                        return {
                            method: call[0],
                            params: call[1]
                        };
                    }),
                    credentials: credentials
                }
            };
            
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function(res) { return res.json(); })
            .then(function(json) {
                if (json.error) {
                    return errorCallback && errorCallback(json.error);
                }
                var results = json.result;
                if (!Array.isArray(results)) {
                    return errorCallback && errorCallback("Invalid ExecuteMultiCall response");
                }
                if (successCallback) successCallback(results);
            })
            .catch(function(err) {
                if (errorCallback) errorCallback(err);
            });
        });
    }

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

    // Variables antiguas eliminadas

    // ─── Carga de la lista de dispositivos (Autocomplete Masivo) ───────────────

    let deviceListLoaded = false;
    let deviceListLoading = false;

    function loadDeviceList() {
        if (deviceListLoaded || deviceListLoading) return;
        deviceListLoading = true;

        if (inputSearch) {
            inputSearch.placeholder = 'Cargando vehículos...';
        }

        // Bypassear el proxy para descargar la lista completa sin ser bloqueados
        directCall('Get', { typeName: 'Device' }, function(devices) {
            deviceListLoaded = true;
            deviceListLoading = false;
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
            console.warn('[reeferMonitor] Fallo carga masiva de flota.', error);
            deviceListLoading = false;
            enableFallbackMode();
        });
    }

    function enableFallbackMode() {
        fallbackMode = true;
        if (inputSearch) {
            inputSearch.placeholder = 'Escribe el nombre exacto (ej: C54)...';
            inputSearch.disabled = false;
        }
    }

    // ─── Carga de un solo vehículo (Fallback) ─────────────────────────
    
    function fetchAndLoadSingleDevice(nameStr) {
        showInfo('Buscando vehículo "' + nameStr + '"...');
        directCall('Get', {
            typeName: 'Device',
            search: { name: nameStr }
        }, function(devices) {
            if (devices && devices.length > 0) {
                var match = devices[0];
                deviceMap[match.name.trim().toUpperCase()] = match.id;
                if (inputSearch) inputSearch.value = match.name;
                loadReeferData(match.id);
            } else {
                showError('Vehículo no encontrado', 'No se encontró un vehículo con el nombre exacto "' + nameStr + '".');
            }
        }, function(error) {
            console.error('[reeferMonitor] Error buscando vehículo individual:', error);
            showError('Error de red', 'No se pudo buscar el vehículo. Verifica tu conexión.');
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

        directMultiCall(calls, function(results) {
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
            
            // Detección robusta de Geotab Drive
            isDriveApp = !!(state && state.drive) || 
                         window.location.href.indexOf('/drive/') !== -1 || 
                         navigator.userAgent.indexOf('Geotab Drive') !== -1;
            
            if (!listenersAttached) {
                listenersAttached = true;

                if (inputSearch) {
                    // Cargar la lista solo cuando el usuario haga clic o enfoque el buscador
                    inputSearch.addEventListener('focus', function() {
                        loadDeviceList();
                    });

                    inputSearch.addEventListener('input', function() {
                        var name = this.value ? this.value.trim().toUpperCase() : '';
                        
                        // Si ya tenemos el ID exacto, cargar automáticamente
                        var id = deviceMap[name];
                        if (id) {
                            loadReeferData(id);
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

            var foundId = null;

            // 1. Primero intentar obtener el ID del remolque (frigorífico)
            if (state && state.trailers && state.trailers.length > 0) {
                var trailerId = typeof state.trailers[0] === 'string'
                    ? state.trailers[0]
                    : (state.trailers[0].id || state.trailers[0].Id || null);

                if (trailerId && !PLACEHOLDER_IDS.has(trailerId)) {
                    foundId = trailerId;
                }
            }

            // 2. Si no hay remolque, intentar obtener el ID del vehículo
            if (!foundId && state && state.device) {
                var devId = typeof state.device === 'string'
                    ? state.device
                    : (state.device.id || state.device.Id || null);

                if (devId && !PLACEHOLDER_IDS.has(devId)) {
                    foundId = devId;
                }
            }

            if (foundId) {
                currentDeviceId = foundId;
            }

            if (currentDeviceId) {
                loadReeferData(currentDeviceId);
                refreshInterval = setInterval(function() {
                    if (currentDeviceId) loadReeferData(currentDeviceId);
                }, 60000);
            }

            // No cargar la lista de dispositivos masivamente al inicio.
            // Se cargará solo si el usuario interactúa con el buscador (focus).
        },

        blur: function () {
            if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
        }
    };
};