geotab.addin.reeferMonitor = function (api, state) {

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

    // IDs ficticios que Geotab Drive devuelve cuando la sesión aún no está lista
    const PLACEHOLDER_IDS = new Set(['b2', 'b1', '0', '']);

    // Estado interno
    let refreshInterval  = null;
    let loadRetryTimeout = null;
    let loadRetryCount   = 0;
    const MAX_RETRIES    = 8;
    let chartInstance    = null;
    let deviceMap        = {};
    let currentDeviceId  = null;
    let sessionError     = false;
    let listenersAttached = false; // Evita duplicar listeners si initialize() se llama 2 veces

    // Referencias DOM
    const inputSearch = document.getElementById('deviceSearch');
    const dataList    = document.getElementById('devicesList');
    const btnRefresh  = document.getElementById('btn-fetch-data');
    const panel       = document.getElementById('results-panel');

    // ─── Utilidades de UI ──────────────────────────────────────────────────────

    function showInfo(msg) {
        if (panel) panel.innerHTML = `<p style="padding:15px; color:#64748b;">${msg}</p>`;
    }

    function showError(title, message, canRetry) {
        if (!panel) return;
        const retryBtn = canRetry
            ? `<br><br><button onclick="window.__reeferRetry && window.__reeferRetry()"
                style="margin-top:10px; padding:8px 20px; background:#2563eb; color:#fff;
                       border:none; border-radius:4px; cursor:pointer; font-size:14px;">🔄 Reintentar</button>`
            : '';
        panel.innerHTML = `
        <div style="padding:15px; background:#fee2e2; color:#b91c1c;
                    border-radius:4px; border:1px solid #f87171; margin-top:15px;">
            <strong style="font-size:16px;">${title}</strong><br><br>
            ${message}${retryBtn}
        </div>`;
    }

    function resetErrorState() {
        sessionError = false;
        if (inputSearch) {
            inputSearch.disabled = false;
            if (inputSearch.placeholder.includes('Error') ||
                inputSearch.placeholder.includes('Conectando')) {
                inputSearch.placeholder = 'Escribe o selecciona una unidad...';
            }
        }
    }

    // ─── Detección de tipo de error ────────────────────────────────────────────

    function isNetworkError(error) {
        if (!error) return false;
        const t = error.data && (error.data.type || '');
        return t === 'NetworkError' || t === 'network';
    }

    function isAuthError(error) {
        if (!error) return false;
        const code = String(error.code || '');
        const msg  = String(error.message || '').toLowerCase();
        return code === 'InvalidUserException' ||
               code === 'AuthenticationException' ||
               msg.includes('authenticated') ||
               msg.includes('invalid user') ||
               msg.includes('session');
    }

    // ─── Manejo de errores graves ──────────────────────────────────────────────

    function handleSessionError(error) {
        if (refreshInterval)  { clearInterval(refreshInterval);   refreshInterval  = null; }
        if (loadRetryTimeout) { clearTimeout(loadRetryTimeout);   loadRetryTimeout = null; }
        sessionError = true;
        console.error('[reeferMonitor] Sesión inválida detectada:', error);

        if (inputSearch) {
            inputSearch.placeholder = '⚠️ Error de sesión detectado.';
            inputSearch.disabled = true;
        }

        window.__reeferRetry = function() {
            resetErrorState();
            loadRetryCount = 0;
            showInfo('Reintentando conexión...');
            // Usar el api más reciente guardado globalmente
            if (window.__reeferCurrentApi) {
                loadDeviceList(window.__reeferCurrentApi, function() {
                    if (currentDeviceId && !PLACEHOLDER_IDS.has(currentDeviceId)) {
                        loadReeferData(currentDeviceId);
                    }
                });
            }
        };

        showError(
            'Error de Sesión Inválida',
            `Se ha detectado un problema con la sesión.<br><br>
            <strong>Solución recomendada:</strong><br>
            1. Cierra la sesión en Geotab Drive.<br>
            2. Limpia la caché de la aplicación.<br>
            3. Vuelve a iniciar sesión.`,
            true
        );
    }

    // ─── Carga de la lista de dispositivos (con reintentos) ────────────────────

    function loadDeviceList(apiRef, onSuccess) {
        if (inputSearch) inputSearch.placeholder = 'Cargando flota, por favor espera...';

        apiRef.call('Get', { typeName: 'Device' }, function(devices) {
            loadRetryCount = 0;
            devices.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            deviceMap = {};
            if (dataList) dataList.innerHTML = '';
            devices.forEach(function(d) {
                if (d.name) {
                    const option = document.createElement('option');
                    option.value = d.name;
                    if (dataList) dataList.appendChild(option);
                    deviceMap[d.name] = d.id;
                }
            });

            if (inputSearch) inputSearch.placeholder = 'Escribe o selecciona una unidad...';
            console.log('[reeferMonitor] Flota cargada: ' + devices.length + ' activos.');

            if (typeof onSuccess === 'function') onSuccess();

        }, function(error) {
            console.error('[reeferMonitor] Error cargando dispositivos:', error);

            if (isAuthError(error)) {
                // Error real de autenticación: no reintentar
                handleSessionError(error);
            } else if (isNetworkError(error) || (error && error.code === 400)) {
                // NetworkError o 400 = sesión aún estableciéndose → reintentar
                scheduleLoadRetry(apiRef, onSuccess);
            } else {
                handleSessionError(error);
            }
        });
    }

    function scheduleLoadRetry(apiRef, onSuccess) {
        if (loadRetryCount >= MAX_RETRIES) {
            console.error('[reeferMonitor] Máximo de reintentos alcanzado.');
            handleSessionError({ message: 'No se pudo conectar tras ' + MAX_RETRIES + ' intentos.' });
            return;
        }
        // Backoff exponencial: 3s, 6s, 12s, 24s, 30s (máx)
        const delay = Math.min(3000 * Math.pow(2, loadRetryCount), 30000);
        loadRetryCount++;
        console.warn('[reeferMonitor] NetworkError transitorio. Reintento ' +
                     loadRetryCount + '/' + MAX_RETRIES + ' en ' + (delay / 1000) + 's...');

        if (inputSearch) {
            inputSearch.placeholder = 'Conectando... (intento ' + loadRetryCount + '/' + MAX_RETRIES + ')';
        }

        loadRetryTimeout = setTimeout(function() {
            loadDeviceList(apiRef, onSuccess);
        }, delay);
    }

    // ─── Carga de datos de telemetría ──────────────────────────────────────────

    function loadReeferData(deviceId) {
        if (!deviceId || sessionError || PLACEHOLDER_IDS.has(deviceId)) return;
        currentDeviceId = deviceId;

        const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const diagKeys = Object.keys(DIAG_CONFIG);

        const calls = diagKeys.map(function(id) {
            return ['Get', {
                typeName: 'StatusData',
                search: { deviceSearch: { id: deviceId }, diagnosticSearch: { id: id }, fromDate: fromDate }
            }];
        });
        calls.push(['Get', {
            typeName: 'FaultData',
            search: { deviceSearch: { id: deviceId }, fromDate: fromDate }
        }]);

        api.multiCall(calls, function(results) {
            const faultsData    = results.pop();
            const telemetryData = results;
            renderTable(telemetryData, diagKeys, faultsData.length);
            renderChart(telemetryData, diagKeys);
        }, function(error) {
            console.error('[reeferMonitor] Error cargando telemetría (código: ' +
                          (error && error.code) + '):', error);
            if (isAuthError(error)) {
                handleSessionError(error);
            } else {
                window.__reeferRetry = function() {
                    showInfo('Reintentando...');
                    loadReeferData(currentDeviceId);
                };
                showError('Error al cargar telemetría',
                    'No se pudieron obtener los datos del vehículo. Inténtalo de nuevo.', true);
            }
        });
    }

    // ─── Render: tabla ─────────────────────────────────────────────────────────

    function renderTable(telemetryData, diagKeys, totalAlerts) {
        let html = '<table style="width:100%; border-collapse:collapse; margin-top:15px; font-family:sans-serif;">';
        html += '<tr style="background:#f3f4f6; border-bottom:2px solid #cbd5e1;">' +
                '<th style="text-align:left; padding:12px;">Medición</th>' +
                '<th style="text-align:right; padding:12px;">Valor / Validez</th></tr>';

        telemetryData.forEach(function(data, index) {
            const key     = diagKeys[index];
            const cfg     = DIAG_CONFIG[key];
            const hasData = data && data.length > 0;

            if (cfg.force || hasData) {
                let displayValue   = '---';
                let timeWarningHtml = '';

                if (hasData) {
                    const lastRecord = data[data.length - 1];
                    const rawVal     = lastRecord.data;
                    displayValue = cfg.type === 'temp' ? rawVal.toFixed(1) + ' ºC' : rawVal;

                    const recordTime  = new Date(lastRecord.dateTime);
                    const diffMinutes = Math.floor((Date.now() - recordTime) / 60000);

                    if (diffMinutes <= 15) {
                        timeWarningHtml = '<span style="display:block; font-size:11px; color:#16a34a;">✔ Tiempo real</span>';
                    } else if (diffMinutes < 60) {
                        timeWarningHtml = '<span style="display:block; font-size:11px; color:#d97706; font-weight:bold;">⚠ Hace ' + diffMinutes + ' min</span>';
                    } else {
                        const diffHours     = Math.floor(diffMinutes / 60);
                        const formattedTime = recordTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        timeWarningHtml = '<span style="display:block; font-size:11px; color:#dc2626; font-weight:bold;">❌ Desconectado (Hora: ' + formattedTime + ' - Hace ' + diffHours + 'h)</span>';
                    }
                } else if (cfg.force) {
                    timeWarningHtml = '<span style="display:block; font-size:11px; color:#94a3b8;">Sin registros</span>';
                }

                html += '<tr style="border-bottom:1px solid #e2e8f0;">' +
                        '<td style="padding:12px; font-weight:500; color:#1e293b;">' + cfg.label + '</td>' +
                        '<td style="padding:12px; text-align:right; font-weight:bold; color:#0f172a;">' +
                            displayValue + ' ' + timeWarningHtml +
                        '</td></tr>';
            }
        });

        html += '<tr style="border-bottom:1px solid #e2e8f0; background:#fff1f2;">' +
                '<td style="padding:12px; color:#be123c; font-weight:bold;">Total Alertas Activas (24h)</td>' +
                '<td style="padding:12px; text-align:right; font-weight:bold; color:#be123c;">' + totalAlerts + '</td>' +
                '</tr>';
        html += '</table>';
        if (panel) panel.innerHTML = html;
    }

    // ─── Render: gráfica ────────────────────────────────────────────────────────

    function renderChart(telemetryData, diagKeys) {
        const ctx      = document.getElementById('reeferChart').getContext('2d');
        const datasets = [];
        let colorIndex = 0;
        const now        = new Date();
        const limitsFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        telemetryData.forEach(function(data, index) {
            const key = diagKeys[index];
            const cfg = DIAG_CONFIG[key];
            if (data && data.length > 0 && cfg.type === 'temp') {
                datasets.push({
                    label:           cfg.label,
                    data:            data.map(function(d) { return { x: new Date(d.dateTime), y: d.data }; }),
                    borderColor:     CHART_COLORS[colorIndex % CHART_COLORS.length],
                    backgroundColor: 'transparent',
                    borderWidth:     2.5,
                    pointRadius:     1,
                    pointHoverRadius: 5,
                    tension:         0.1
                });
                colorIndex++;
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
                            unit: 'hour',
                            stepSize: 2,
                            displayFormats:  { hour: 'HH:mm' },
                            tooltipFormat:   'dd/MM HH:mm'
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

        /**
         * initialize() se llama una vez al cargar el add-in.
         * SOLO debe registrar listeners DOM y llamar a callback().
         * NUNCA debe hacer llamadas a la API aquí: Geotab puede llamar a
         * initialize() de nuevo durante una transición de sesión, y en ese
         * momento el token aún no es válido.
         */
        initialize: function (api, state, callback) {
            window.__reeferCurrentApi = api; // Guardamos para el botón de reintento

            // Protección contra initialize() llamado dos veces
            if (!listenersAttached) {
                listenersAttached = true;

                if (inputSearch) {
                    inputSearch.addEventListener('input', function() {
                        const id = deviceMap[this.value];
                        if (id) loadReeferData(id);
                    });
                }

                if (btnRefresh) {
                    btnRefresh.addEventListener('click', function() {
                        const name    = inputSearch ? inputSearch.value : '';
                        const foundId = deviceMap[name];
                        if (foundId) {
                            loadReeferData(foundId);
                        } else if (currentDeviceId) {
                            loadReeferData(currentDeviceId);
                        } else {
                            alert('Por favor, selecciona un vehículo válido de la lista.');
                        }
                    });
                }
            }

            callback();
        },

        /**
         * focus() se llama cada vez que el usuario entra al add-in.
         * Aquí es donde se hacen las llamadas a la API, porque en este punto
         * la sesión de Geotab Drive ya está completamente establecida.
         */
        focus: function (api, state) {
            window.__reeferCurrentApi = api; // Actualizar referencia al api válido

            // Limpiar timers anteriores
            if (refreshInterval)  { clearInterval(refreshInterval);   refreshInterval  = null; }
            if (loadRetryTimeout) { clearTimeout(loadRetryTimeout);   loadRetryTimeout = null; }
            loadRetryCount = 0;

            // Resetear cualquier error previo
            resetErrorState();

            // Log de diagnóstico
            console.log('[reeferMonitor] focus() state.device:',
                state && state.device ? JSON.stringify(state.device) : '(sin dispositivo)');

            // Leer el ID del vehículo que Geotab Drive asigna al conductor
            if (state && state.device) {
                const devId = typeof state.device === 'string'
                    ? state.device
                    : (state.device.id || state.device.Id || null);

                if (devId && !PLACEHOLDER_IDS.has(devId)) {
                    currentDeviceId = devId;
                    console.log('[reeferMonitor] Vehículo asignado por Drive:', devId);
                } else {
                    console.log('[reeferMonitor] state.device.id es un placeholder ("' + devId + '"), ignorado.');
                }
            }

            // Recargar siempre la lista de dispositivos con el api de sesión actual.
            // Esto garantiza que, aunque initialize() haya fallado o se haya llamado
            // dos veces, focus() recupera la flota con el token fresco.
            loadDeviceList(api, function() {
                // Actualizar el buscador si ya hay un vehículo seleccionado
                if (currentDeviceId && inputSearch && !inputSearch.value) {
                    const devName = Object.keys(deviceMap).find(function(k) {
                        return deviceMap[k] === currentDeviceId;
                    });
                    if (devName) inputSearch.value = devName;
                }

                // Cargar datos de telemetría si hay vehículo
                if (currentDeviceId && !PLACEHOLDER_IDS.has(currentDeviceId)) {
                    loadReeferData(currentDeviceId);
                    refreshInterval = setInterval(function() {
                        if (currentDeviceId && !sessionError) loadReeferData(currentDeviceId);
                    }, 60000);
                }
            });
        },

        blur: function () {
            if (refreshInterval)  { clearInterval(refreshInterval);   refreshInterval  = null; }
            if (loadRetryTimeout) { clearTimeout(loadRetryTimeout);   loadRetryTimeout = null; }
            loadRetryCount = 0;
        }
    };
};
