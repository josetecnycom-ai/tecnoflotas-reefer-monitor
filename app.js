geotab.addin.reeferMonitor = function (outerApi, state) {

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
    let currentApi        = outerApi; // Referencia global al API válido más reciente
    let refreshInterval   = null;
    let loadRetryTimeout  = null;
    let loadRetryCount    = 0;
    // MAX_RETRIES a 5 (da más margen si la conexión en el navegador es inestable)
    const MAX_RETRIES     = 5; 
    let chartInstance     = null;
    let deviceMap         = {};
    let currentDeviceId   = null;
    let listenersAttached = false;
    let permanentError    = false;

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

    function showPermanentSessionError() {
        permanentError = true;
        cancelPendingRetries();
        if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }

        if (inputSearch) {
            inputSearch.placeholder = '⚠️ Sesión no disponible';
            inputSearch.disabled = true;
        }

        console.error('[reeferMonitor] Sesión permanentemente inválida. Probable causa: otro dispositivo tiene la sesión activa.');

        showError(
            'Sesión no disponible',
            'No se puede conectar con el servidor de Geotab.<br><br>' +
            '<strong>Causa más probable:</strong><br>' +
            'Otro dispositivo (móvil u ordenador) tiene la sesión activa con este mismo usuario, o la sesión ha caducado.<br><br>' +
            '<strong>Solución:</strong><br>' +
            '1. Cierra sesión en otros dispositivos.<br>' +
            '2. Pulsa <strong>"Recargar"</strong> para reconectar.',
            '🔄 Recargar página',
            function() { window.location.reload(); }
        );
    }

    // ─── Carga de la lista de dispositivos ─────────────────────────────────────

    function loadDeviceList(onSuccess) {
        if (permanentError) return;

        if (inputSearch) {
            inputSearch.placeholder = loadRetryCount === 0
                ? 'Cargando flota...'
                : 'Conectando... (intento ' + loadRetryCount + '/' + MAX_RETRIES + ')';
        }

        // Se usa currentApi siempre (que se actualiza en focus)
        currentApi.call('Get', { typeName: 'Device' }, function(devices) {
            cancelPendingRetries();
            permanentError = false;
            if (inputSearch) inputSearch.disabled = false;

            devices.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
            deviceMap = {};
            if (dataList) dataList.innerHTML = '';
            
            devices.forEach(function(d) {
                if (d.name) {
                    var option = document.createElement('option');
                    option.value = d.name;
                    if (dataList) dataList.appendChild(option);
                    // Guardar en UPPERCASE y sin espacios al inicio/fin para búsquedas robustas
                    deviceMap[d.name.trim().toUpperCase()] = d.id;
                }
            });

            if (inputSearch) inputSearch.placeholder = 'Escribe o selecciona una unidad...';
            console.log('[reeferMonitor] Flota cargada: ' + devices.length + ' activos.');

            if (typeof onSuccess === 'function') onSuccess();

        }, function(error) {
            console.error('[reeferMonitor] Error cargando dispositivos (intento ' +
                          loadRetryCount + '):', error && error.code, error && error.data && error.data.type);

            if (isNetworkError(error) || (error && error.code === 400)) {
                if (loadRetryCount < MAX_RETRIES) {
                    var delay = Math.min(3000 * Math.pow(2, loadRetryCount), 15000); 
                    loadRetryCount++;
                    console.warn('[reeferMonitor] Reintento ' + loadRetryCount + '/' + MAX_RETRIES +
                                 ' en ' + (delay / 1000) + 's...');
                    loadRetryTimeout = setTimeout(function() {
                        loadDeviceList(onSuccess);
                    }, delay);
                } else {
                    showPermanentSessionError();
                }
            } else {
                showPermanentSessionError();
            }
        });
    }

    // ─── Carga de datos de telemetría ──────────────────────────────────────────

    function loadReeferData(deviceId) {
        if (!deviceId || permanentError || PLACEHOLDER_IDS.has(deviceId)) return;
        currentDeviceId = deviceId;

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

        // Asegurarse de usar currentApi, NO el outerApi que podría estar caducado
        currentApi.multiCall(calls, function(results) {
            var faultsData    = results.pop();
            var telemetryData = results;
            renderTable(telemetryData, diagKeys, faultsData.length);
            renderChart(telemetryData, diagKeys);
        }, function(error) {
            console.error('[reeferMonitor] Error telemetría:', error && error.code, error);
            window.__reeferAction = function() {
                showInfo('Reintentando...');
                loadReeferData(currentDeviceId);
            };
            showError('Error al cargar datos',
                'No se pudieron obtener los datos del vehículo.',
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
            currentApi = api; // Guardar referencia inicial
            if (!listenersAttached) {
                listenersAttached = true;

                if (inputSearch) {
                    inputSearch.addEventListener('input', function() {
                        var name = this.value ? this.value.trim().toUpperCase() : '';
                        var id = deviceMap[name];
                        if (id) loadReeferData(id);
                    });
                }

                if (btnRefresh) {
                    btnRefresh.addEventListener('click', function() {
                        if (permanentError) {
                            window.location.reload();
                            return;
                        }
                        var name    = inputSearch ? inputSearch.value.trim().toUpperCase() : '';
                        var foundId = deviceMap[name];
                        
                        if (foundId) {
                            loadReeferData(foundId);
                        } else if (currentDeviceId) {
                            loadReeferData(currentDeviceId);
                        } else {
                            // En móvil alert() suele estar suprimido, usamos showError
                            showError(
                                'Vehículo no encontrado',
                                'Por favor, selecciona un vehículo válido de la lista o comprueba que el nombre coincida exactamente.'
                            );
                        }
                    });
                }
            }
            callback();
        },

        focus: function (api, state) {
            currentApi = api; // ¡CRÍTICO! Actualizar con la sesión fresca de cada entrada

            if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }

            console.log('[reeferMonitor] focus() state.device:',
                state && state.device ? JSON.stringify(state.device) : '(sin dispositivo)');

            if (permanentError) {
                console.warn('[reeferMonitor] focus() ignorado: permanentError activo. El usuario debe recargar la página.');
                return;
            }

            cancelPendingRetries();

            if (state && state.device) {
                var devId = typeof state.device === 'string'
                    ? state.device
                    : (state.device.id || state.device.Id || null);

                if (devId && !PLACEHOLDER_IDS.has(devId)) {
                    currentDeviceId = devId;
                    console.log('[reeferMonitor] Vehículo asignado por Drive:', devId);
                } else {
                    console.log('[reeferMonitor] state.device.id es un placeholder ("' + devId + '"), ignorado.');
                }
            }

            loadDeviceList(function() {
                if (currentDeviceId && inputSearch && !inputSearch.value) {
                    // Restaurar nombre exacto (insensible a mayúsculas guardado, pero funciona)
                    var devName = Object.keys(deviceMap).find(function(k) {
                        return deviceMap[k] === currentDeviceId;
                    });
                    if (devName) inputSearch.value = devName;
                }

                if (currentDeviceId && !PLACEHOLDER_IDS.has(currentDeviceId)) {
                    loadReeferData(currentDeviceId);
                    refreshInterval = setInterval(function() {
                        if (!permanentError && currentDeviceId) loadReeferData(currentDeviceId);
                    }, 60000);
                }
            });
        },

        blur: function () {
            if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
        }
    };
};