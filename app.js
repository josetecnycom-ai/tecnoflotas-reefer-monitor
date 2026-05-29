geotab.addin.reeferMonitor = function (api, state) {
    
    const DIAG_CONFIG = {
        "RefrigerationUnitSetTemperatureZone1Id": { label: "Set Point Zona 1", type: "temp", force: true },
        "RefrigerationUnitSetTemperatureZone2Id": { label: "Set Point Zona 2", type: "temp", force: true },
        "RefrigerationUnitStatusId": { label: "Estado de la unidad", type: "status", force: true },
        "DiagnosticCargoTemperatureZone1Id": { label: "Temp. Carga Zona 1", type: "temp", force: false },
        "DiagnosticCargoTemperatureZone2Id": { label: "Temp. Carga Zona 2", type: "temp", force: false },
        "DiagnosticCargoTemperatureZone3Id": { label: "Temp. Carga Zona 3", type: "temp", force: false },
        "RefrigerationUnitSetTemperatureZone3Id": { label: "Set Point Zona 3", type: "temp", force: false },
        "RefrigerationUnitDischargeTemperatureZone1Id": { label: "Descarga Zona 1", type: "temp", force: false },
        "RefrigerationUnitDischargeTemperatureZone2Id": { label: "Descarga Zona 2", type: "temp", force: false },
        "RefrigerationUnitDischargeTemperatureZone3Id": { label: "Descarga Zona 3", type: "temp", force: false },
        "DiagnosticDoor1StatusId": { label: "Puerta 1", type: "door", force: false },
        "DiagnosticDoor2StatusId": { label: "Puerta 2", type: "door", force: false }
    };

    const CHART_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
    // IDs ficticios que Geotab Drive devuelve cuando aún no hay vehículo asignado
    const PLACEHOLDER_IDS = new Set(['b2', 'b1', '0', '', null, undefined]);

    let refreshInterval = null;
    let initRetryTimeout = null;
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 5;
    let chartInstance = null;
    let deviceMap = {};
    let currentDeviceId = null;
    let sessionError = false;

    const inputSearch = document.getElementById('deviceSearch');
    const dataList = document.getElementById('devicesList');
    const btnRefresh = document.getElementById('btn-fetch-data');
    const panel = document.getElementById('results-panel');

    function showError(title, message, canRetry) {
        if (panel) {
            const retryBtn = canRetry
                ? `<br><br><button onclick="window.__reeferRetry && window.__reeferRetry()" style="margin-top:10px; padding:8px 20px; background:#2563eb; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:14px;">🔄 Reintentar</button>`
                : '';
            panel.innerHTML = `
            <div style="padding: 15px; background: #fee2e2; color: #b91c1c; border-radius: 4px; border: 1px solid #f87171; margin-top: 15px;">
                <strong style="font-size: 16px;">${title}</strong><br><br>
                ${message}
                ${retryBtn}
            </div>`;
        }
    }

    function resetErrorState() {
        sessionError = false;
        if (inputSearch) {
            inputSearch.disabled = false;
            if (inputSearch.placeholder.includes('Error') || inputSearch.placeholder.includes('espera')) {
                inputSearch.placeholder = "Escribe o selecciona una unidad...";
            }
        }
    }

    // Un error 400 con type:NetworkError es transitorio (la sesión de Geotab aún se está estableciendo)
    function isNetworkError(error) {
        if (!error) return false;
        const dataType = error.data && (error.data.type || '');
        return dataType === 'NetworkError' || dataType === 'network';
    }

    // Reintenta la carga de la lista de dispositivos con backoff exponencial
    function scheduleInitRetry(apiRef) {
        if (initRetryCount >= MAX_INIT_RETRIES) {
            console.error('[reeferMonitor] Máximo de reintentos alcanzado en initialize.');
            handleSessionError({ message: 'No se pudo conectar tras varios intentos.' });
            return;
        }
        const delay = Math.min(3000 * Math.pow(2, initRetryCount), 30000); // 3s, 6s, 12s, 24s, 30s
        initRetryCount++;
        console.warn(`[reeferMonitor] NetworkError transitorio. Reintento ${initRetryCount}/${MAX_INIT_RETRIES} en ${delay/1000}s...`);

        if (inputSearch) inputSearch.placeholder = `Conectando... (intento ${initRetryCount}/${MAX_INIT_RETRIES})`;

        initRetryTimeout = setTimeout(function() {
            apiRef.call('Get', { typeName: 'Device' }, function(devices) {
                initRetryCount = 0; // Éxito: resetear contador
                devices.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                deviceMap = {};
                if (dataList) dataList.innerHTML = '';
                devices.forEach(d => {
                    if (d.name) {
                        let option = document.createElement('option');
                        option.value = d.name;
                        if (dataList) dataList.appendChild(option);
                        deviceMap[d.name] = d.id;
                    }
                });
                if (inputSearch) inputSearch.placeholder = 'Escribe o selecciona una unidad...';
                console.log(`[reeferMonitor] Flota cargada tras reintento: ${devices.length} activos.`);
                // Si ya había un vehículo seleccionado, cargamos sus datos
                if (currentDeviceId && !PLACEHOLDER_IDS.has(currentDeviceId)) {
                    loadReeferData(currentDeviceId);
                }
            }, function(err) {
                if (isNetworkError(err)) {
                    scheduleInitRetry(apiRef);
                } else {
                    handleSessionError(err);
                }
            });
        }, delay);
    }

    function handleSessionError(error) {
        // Detener el intervalo de refresco inmediatamente
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
        sessionError = true;
        console.error("Sesión inválida detectada. Se han detenido todos los reintentos.", error);

        if (inputSearch) {
            inputSearch.placeholder = "⚠️ Error de sesión detectado.";
            inputSearch.disabled = true;
        }

        // Botón de reintento: resetea el flag y vuelve a intentar
        window.__reeferRetry = function() {
            resetErrorState();
            if (panel) panel.innerHTML = '<p style="padding:15px; color:#64748b;">Reintentando conexión...</p>';
            api.call("Get", { typeName: "Device" }, function(devices) {
                devices.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
                deviceMap = {};
                if (dataList) dataList.innerHTML = '';
                devices.forEach(d => {
                    if (d.name) {
                        let option = document.createElement('option');
                        option.value = d.name;
                        if (dataList) dataList.appendChild(option);
                        deviceMap[d.name] = d.id;
                    }
                });
                if (inputSearch) inputSearch.placeholder = "Escribe o selecciona una unidad...";
                if (currentDeviceId) loadReeferData(currentDeviceId);
            }, function(err) {
                handleSessionError(err);
            });
        };

        showError(
            "Error de Sesión Inválida",
            `Se ha detectado un problema con la sesión, probablemente por iniciar sesión en otro dispositivo con este mismo usuario.<br><br>
            <strong>Solución recomendada:</strong><br>
            1. Cierra la sesión en Geotab.<br>
            2. Limpia la caché y los datos de la aplicación en tu móvil.<br>
            3. Vuelve a iniciar sesión.`,
            true
        );
    }

    function handlePermissionError(error) {
        // Error 400 en datos de telemetría: puede ser falta de permisos del conductor, no un error de sesión
        console.warn("Error 400 en telemetría (posible falta de permisos):", error);

        // Exponemos el reintento sin bloquear permanentemente la app
        window.__reeferRetry = function() {
            if (panel) panel.innerHTML = '<p style="padding:15px; color:#64748b;">Reintentando...</p>';
            if (currentDeviceId) loadReeferData(currentDeviceId);
        };

        showError(
            "Sin acceso a los datos de telemetría",
            `El servidor ha devuelto un error al consultar los datos del vehículo.<br><br>
            <strong>Posibles causas:</strong><br>
            • El rol del conductor no tiene permisos para leer datos de telemetría.<br>
            • El vehículo no tiene unidad de refrigeración activa.<br>
            • El servidor de Geotab ha rechazado la consulta.<br><br>
            Contacta con el administrador si el problema persiste.`,
            true
        );
    }

    function loadReeferData(deviceId) {
        if (!deviceId || sessionError) return; // No hacer nada si la sesión está rota
        currentDeviceId = deviceId;
        
        const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const diagKeys = Object.keys(DIAG_CONFIG);
        
        let calls = diagKeys.map(id => ["Get", {
            typeName: "StatusData",
            search: { deviceSearch: { id: deviceId }, diagnosticSearch: { id: id }, fromDate: fromDate }
        }]);

        calls.push(["Get", {
            typeName: "FaultData",
            search: { deviceSearch: { id: deviceId }, fromDate: fromDate }
        }]);

        api.multiCall(calls, function(results) {
            const faultsData = results.pop();
            const telemetryData = results;
            
            renderTable(telemetryData, diagKeys, faultsData.length);
            renderChart(telemetryData, diagKeys);
        }, function(error) {
            console.error("Error cargando telemetría (código:", error && error.code, "):", error);
            // InvalidUserException o AuthenticationException = error de sesión real
            if (error && (error.code === "InvalidUserException" || error.code === "AuthenticationException"
                || String(error.message).toLowerCase().includes("authenticated")
                || String(error.message).toLowerCase().includes("session"))) {
                handleSessionError(error);
            } else if (error && (error.code === 400 || String(error.message).toLowerCase().includes("bad request"))) {
                // 400 en telemetría = probablemente permisos insuficientes del conductor, NO bloquear la app
                handlePermissionError(error);
            } else {
                showError("Error de conexión",
                    "No se han podido descargar los datos del vehículo. Inténtalo de nuevo.",
                    true);
            }
        });
    }

    function renderTable(telemetryData, diagKeys, totalAlerts) {
        let html = '<table style="width:100%; border-collapse: collapse; margin-top: 15px; font-family: sans-serif;">';
        html += '<tr style="background:#f3f4f6; border-bottom: 2px solid #cbd5e1;"><th style="text-align:left; padding:12px;">Medición</th><th style="text-align:right; padding:12px;">Valor / Validez</th></tr>';
        
        telemetryData.forEach((data, index) => {
            const key = diagKeys[index];
            const cfg = DIAG_CONFIG[key];
            const hasData = data && data.length > 0;
            
            if (cfg.force || hasData) {
                let displayValue = "---";
                let timeWarningHtml = "";

                if (hasData) {
                    const lastRecord = data[data.length - 1];
                    const rawVal = lastRecord.data;
                    displayValue = cfg.type === 'temp' ? `${rawVal.toFixed(1)} ºC` : rawVal;

                    const recordTime = new Date(lastRecord.dateTime);
                    const diffMinutes = Math.floor((Date.now() - recordTime) / 60000);

                    if (diffMinutes <= 15) {
                        timeWarningHtml = `<span style="display:block; font-size:11px; color:#16a34a;">✔ Tiempo real</span>`;
                    } else if (diffMinutes < 60) {
                        timeWarningHtml = `<span style="display:block; font-size:11px; color:#d97706; font-weight:bold;">⚠ Hace ${diffMinutes} min</span>`;
                    } else {
                        const diffHours = Math.floor(diffMinutes / 60);
                        const formattedTime = recordTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                        timeWarningHtml = `<span style="display:block; font-size:11px; color:#dc2626; font-weight:bold;">❌ Desconectado (Hora: ${formattedTime} - Hace ${diffHours}h)</span>`;
                    }
                } else if (cfg.force) {
                    timeWarningHtml = `<span style="display:block; font-size:11px; color:#94a3b8;">Sin registros</span>`;
                }

                html += `<tr style="border-bottom: 1px solid #e2e8f0;">
                            <td style="padding: 12px; font-weight: 500; color:#1e293b;">${cfg.label}</td>
                            <td style="padding: 12px; text-align:right; font-weight:bold; color:#0f172a;">
                                ${displayValue} ${timeWarningHtml}
                            </td>
                         </tr>`;
            }
        });

        html += `<tr style="border-bottom: 1px solid #e2e8f0; background: #fff1f2;">
                    <td style="padding: 12px; color: #be123c; font-weight: bold;">Total Alertas Activas (24h)</td>
                    <td style="padding: 12px; text-align:right; font-weight:bold; color: #be123c;">${totalAlerts}</td>
                 </tr>`;
        
        html += '</table>';
        panel.innerHTML = html;
    }

    function renderChart(telemetryData, diagKeys) {
        const ctx = document.getElementById('reeferChart').getContext('2d');
        const datasets = [];
        let colorIndex = 0;

        const now = new Date();
        const limitsFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        telemetryData.forEach((data, index) => {
            const key = diagKeys[index];
            const cfg = DIAG_CONFIG[key];
            
            if (data && data.length > 0 && cfg.type === 'temp') {
                datasets.push({
                    label: cfg.label,
                    data: data.map(d => ({ x: new Date(d.dateTime), y: d.data })),
                    borderColor: CHART_COLORS[colorIndex % CHART_COLORS.length],
                    backgroundColor: 'transparent',
                    borderWidth: 2.5,
                    pointRadius: 1,
                    pointHoverRadius: 5,
                    tension: 0.1
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
                            displayFormats: { hour: 'HH:mm' },
                            tooltipFormat: 'dd/MM HH:mm'
                        },
                        grid: { color: '#f1f5f9' },
                        title: { display: true, text: 'Línea de tiempo (Últimas 24 Horas)', color: '#64748b' }
                    },
                    y: {
                        grid: { color: '#e2e8f0' },
                        title: { display: true, text: 'Temperatura (ºC)', color: '#64748b' }
                    }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
                }
            }
        });
    }

    return {
        initialize: function (api, state, callback) {
            
            if (inputSearch) inputSearch.placeholder = "Cargando flota, por favor espera...";

            api.call("Get", { typeName: "Device" }, function (devices) {
                devices.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

                devices.forEach(d => {
                    if (d.name) {
                        let option = document.createElement('option');
                        option.value = d.name;
                        dataList.appendChild(option);
                        deviceMap[d.name] = d.id;
                    }
                });

                if (inputSearch) inputSearch.placeholder = "Escribe o selecciona una unidad...";
                console.log(`Buscador inicializado con ${devices.length} activos.`);
            }, function(error) {
                console.error('[reeferMonitor] Error cargando dispositivos:', error);
                if (isNetworkError(error)) {
                    // Error transitorio: Geotab Drive aún está completando la autenticación → reintentar
                    scheduleInitRetry(api);
                } else {
                    // Error real de sesión (credenciales inválidas, token caducado, etc.)
                    handleSessionError(error);
                }
            });

            inputSearch.addEventListener('input', function() {
                if (deviceMap[this.value]) {
                    loadReeferData(deviceMap[this.value]);
                }
            });

            btnRefresh.addEventListener('click', () => {
                const selectedName = inputSearch.value;
                const foundId = deviceMap[selectedName];
                
                if (foundId) {
                    loadReeferData(foundId);
                } else if (currentDeviceId) {
                    loadReeferData(currentDeviceId);
                } else {
                    alert("Por favor, selecciona un vehículo válido de la lista para actualizar.");
                }
            });

            callback();
        },
        focus: function (api, state) {
            // Limpiar cualquier intervalo previo antes de crear uno nuevo (evita duplicados)
            if (refreshInterval) {
                clearInterval(refreshInterval);
                refreshInterval = null;
            }

            // Resetear el flag de error para que el usuario pueda reintentar al volver al add-in
            resetErrorState();

            // Log de diagnóstico: ver qué estructura tiene state en web vs Drive móvil
            console.log("[reeferMonitor] focus() state.device:", state && state.device ? JSON.stringify(state.device) : "(sin dispositivo)");

            // Si Geotab Drive pasa el vehículo del conductor en state, lo usamos
            if (state && state.device) {
                // state.device puede ser un objeto completo o solo { id: '...' }
                const devId = typeof state.device === 'string' ? state.device
                            : (state.device.id || state.device.Id || null);

                // 'b2' y similares son IDs ficticios de Geotab Drive (sin vehículo asignado aún)
                if (devId && !PLACEHOLDER_IDS.has(devId)) {
                    currentDeviceId = devId;
                    console.log('[reeferMonitor] Vehículo asignado por Drive:', devId);
                    // Actualizar visualmente el buscador si ya conocemos el nombre
                    if (inputSearch && !inputSearch.value) {
                        const devName = Object.keys(deviceMap).find(key => deviceMap[key] === currentDeviceId);
                        if (devName) inputSearch.value = devName;
                    }
                } else {
                    console.log('[reeferMonitor] state.device.id es un placeholder (', devId, '), ignorado.');
                }
            }

            if (currentDeviceId) {
                loadReeferData(currentDeviceId);
                refreshInterval = setInterval(() => {
                    if (currentDeviceId && !sessionError) loadReeferData(currentDeviceId);
                }, 60000);
            }
        },
        blur: function () {
            if (refreshInterval) clearInterval(refreshInterval);
        }
    };
};
