    // ======================================================
    // CORE SYSTEM FUNCTIONS
    // ======================================================
    const MOBILE_OPT_QUERY = '(max-width: 768px), (pointer: coarse)';
    let motionProfileCache = null;
    let motionProfileResizeTimer = null;

    function isMobileOptimizedDevice() {
        return window.matchMedia(MOBILE_OPT_QUERY).matches;
    }
    function isReducedMotionDevice() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    function cappedDpr(mobileCap, desktopCap) {
        return Math.min(window.devicePixelRatio || 1, isMobileOptimizedDevice() ? mobileCap : desktopCap);
    }
    function fullHdCappedDpr(width, height, maxDpr = 2.25) {
        const dpr = window.devicePixelRatio || 1;
        const landscape = width >= height;
        const maxWidth = landscape ? 1920 : 1080;
        const maxHeight = landscape ? 1080 : 1920;
        return Math.max(0.75, Math.min(dpr, maxDpr, maxWidth / width, maxHeight / height));
    }
    function maxLongSideDpr(width, height, longSide = 1080, maxDpr = 1.5) {
        const dpr = window.devicePixelRatio || 1;
        return Math.max(0.6, Math.min(dpr, maxDpr, longSide / Math.max(width, height)));
    }
    function getMotionProfile(refresh = false) {
        if (motionProfileCache && !refresh) return motionProfileCache;
        const forcedLowEnd = new URLSearchParams(window.location.search).has('lowend') ||
            localStorage.getItem('force_low_end') === 'true';
        const mobile = isMobileOptimizedDevice();
        const reduced = isReducedMotionDevice();
        const mem = Number(navigator.deviceMemory || 8);
        const cores = Number(navigator.hardwareConcurrency || 8);
        const dpr = window.devicePixelRatio || 1;
        const shortSide = Math.min(window.innerWidth || 999, window.innerHeight || 999);
        const constrainedPhone = mobile && (mem <= 4 || cores <= 4 || (shortSide <= 430 && dpr >= 2.25));
        motionProfileCache = {
            mobile,
            reduced,
            lowEnd: forcedLowEnd || reduced || constrainedPhone
        };
        return motionProfileCache;
    }
    function isLowEndMotionDevice() {
        return getMotionProfile().lowEnd;
    }
    function syncDeviceMotionProfile(refresh = false) {
        const profile = getMotionProfile(refresh);
        [document.documentElement, document.body].filter(Boolean).forEach(el => {
            el.classList.toggle('mobile-optimized-device', profile.mobile);
            el.classList.toggle('low-end-device', profile.lowEnd);
            el.classList.toggle('reduced-motion-device', profile.reduced);
        });
        return profile;
    }
    syncDeviceMotionProfile(true);
    window.addEventListener('resize', () => {
        clearTimeout(motionProfileResizeTimer);
        motionProfileResizeTimer = setTimeout(() => syncDeviceMotionProfile(true), 180);
    }, { passive: true });

    const adaptiveMotionState = {
        active: false,
        averageFrameMs: 0,
        missedFrameRatio: 0,
        longestFrameMs: 0
    };

    window.getAdaptiveMotionState = function() {
        return { ...adaptiveMotionState };
    };

    function setAdaptiveMotionState(active, metrics = {}) {
        Object.assign(adaptiveMotionState, metrics);
        if (adaptiveMotionState.active === active) return;
        adaptiveMotionState.active = active;
        document.documentElement.classList.toggle('adaptive-perf-device', active);
        window.dispatchEvent(new CustomEvent('adaptiveperformancechange', {
            detail: { ...adaptiveMotionState }
        }));
    }

    // Sample short frame windows instead of running another permanent animation loop.
    (function initAdaptiveFrameBudget() {
        if (isReducedMotionDevice() || typeof requestAnimationFrame !== 'function') return;

        const SAMPLE_DURATION = 800;
        let wakeTimer = 0;
        let sampleFrame = 0;
        let slowWindows = 0;
        let healthyWindows = 0;
        let lastQualityChange = 0;

        function stopSampling() {
            if (wakeTimer) clearTimeout(wakeTimer);
            if (sampleFrame) cancelAnimationFrame(sampleFrame);
            wakeTimer = 0;
            sampleFrame = 0;
        }

        function scheduleSample(delay) {
            if (document.hidden || wakeTimer || sampleFrame) return;
            wakeTimer = setTimeout(() => {
                wakeTimer = 0;
                startSample();
            }, delay);
        }

        function renderingIsCovered() {
            return Boolean(
                document.getElementById('boot-canvas') ||
                document.getElementById('init-overlay') ||
                document.querySelector('.loading-screen.active') ||
                document.body?.classList.contains('perf-mode')
            );
        }

        function startSample() {
            if (document.hidden || renderingIsCovered()) {
                scheduleSample(1800);
                return;
            }

            let startedAt = 0;
            let previousAt = 0;
            let frameCount = 0;
            let missedFrames = 0;
            let longestFrameMs = 0;

            function sample(timestamp) {
                sampleFrame = 0;
                if (document.hidden) return;

                if (!startedAt) {
                    startedAt = timestamp;
                    previousAt = timestamp;
                } else {
                    const frameMs = timestamp - previousAt;
                    previousAt = timestamp;
                    frameCount += 1;
                    if (frameMs > 34) missedFrames += 1;
                    longestFrameMs = Math.max(longestFrameMs, frameMs);
                }

                if (timestamp - startedAt < SAMPLE_DURATION) {
                    sampleFrame = requestAnimationFrame(sample);
                    return;
                }

                if (frameCount < 12) {
                    scheduleSample(1600);
                    return;
                }

                const averageFrameMs = (timestamp - startedAt) / frameCount;
                const missedFrameRatio = missedFrames / frameCount;
                const degraded = averageFrameMs > 25 || missedFrameRatio > 0.18 || longestFrameMs > 130;
                const severe = missedFrameRatio > 0.45 || longestFrameMs > 180;
                const healthy = averageFrameMs < 20.5 && missedFrameRatio < 0.08 && longestFrameMs < 90;

                Object.assign(adaptiveMotionState, { averageFrameMs, missedFrameRatio, longestFrameMs });

                if (degraded) {
                    slowWindows += severe ? 2 : 1;
                    healthyWindows = 0;
                } else if (healthy) {
                    healthyWindows += 1;
                    slowWindows = Math.max(0, slowWindows - 1);
                } else {
                    slowWindows = Math.max(0, slowWindows - 1);
                    healthyWindows = 0;
                }

                if (!adaptiveMotionState.active && slowWindows >= 2) {
                    setAdaptiveMotionState(true, { averageFrameMs, missedFrameRatio, longestFrameMs });
                    lastQualityChange = performance.now();
                    slowWindows = 0;
                } else if (
                    adaptiveMotionState.active &&
                    healthyWindows >= 3 &&
                    performance.now() - lastQualityChange > 16000
                ) {
                    setAdaptiveMotionState(false, { averageFrameMs, missedFrameRatio, longestFrameMs });
                    lastQualityChange = performance.now();
                    healthyWindows = 0;
                }

                const nextDelay = adaptiveMotionState.active ? 2600 : (degraded ? 1200 : 4200);
                scheduleSample(nextDelay);
            }

            sampleFrame = requestAnimationFrame(sample);
        }

        document.addEventListener('visibilitychange', () => {
            stopSampling();
            if (!document.hidden) scheduleSample(1200);
        });
        scheduleSample(1400);
    })();

    function initSystemWidgets() {
        setInterval(() => {
            const now = new Date();
            const h = now.getHours();
            const m = now.getMinutes().toString().padStart(2, '0');
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = (h % 12) || 12;
            const timeStr = `${h12}:${m} ${ampm}`;
            const compact = document.getElementById('compactStatusText');
            const ddTime = document.getElementById('ddTime');
            if (compact) compact.innerText = timeStr;
            if (ddTime) ddTime.innerText = timeStr;
        }, 1000);

        fetch('https://ipapi.co/json/')
            .then(r => r.json())
            .then(data => {
                const loc = `${data.city}, ${data.country_code}`.toUpperCase();
                const ddLoc = document.getElementById('ddLoc');
                if (ddLoc) ddLoc.innerText = loc;
            })
            .catch(() => {
                const ddLoc = document.getElementById('ddLoc');
                if (ddLoc) ddLoc.innerText = 'UNKNOWN NODE';
            });
    }

    window.showNamePrompt = function() {
        document.getElementById('namePrompt').classList.add('active');
        SFX.modalOpen();
        triggerHaptic('tap');
    };

    function setPremiumLoaderState(screenId, status, pct = 0, step = '') {
        const screen = document.getElementById(screenId);
        if (!screen) return;
        const value = Math.max(0, Math.min(100, Math.round(pct)));
        const statusEl = screen.querySelector('[data-loader-status]');
        const pctEl = screen.querySelector('[data-loader-pct]');
        const stepEl = screen.querySelector('[data-loader-step]');
        const fillEl = screen.querySelector('[data-loader-fill]');
        screen.style.setProperty('--loader-progress', value + '%');
        if (statusEl) statusEl.textContent = status || '';
        if (pctEl) pctEl.textContent = String(value).padStart(2, '0') + '%';
        if (stepEl) stepEl.textContent = (step || 'SYNC').toUpperCase();
        if (fillEl) fillEl.style.width = value + '%';
    }

    function addPremiumLoaderLine(output, text, className = '') {
        if (!output) return;
        const row = document.createElement('div');
        row.className = 'term-line premium-term-line' + (className ? ' ' + className : '');
        row.textContent = text;
        output.appendChild(row);
        output.scrollTop = output.scrollHeight;
    }

    window.processName = function(event) {
        event.preventDefault();
        const nameInput = document.getElementById('guestNameInput').value.trim();
        const userName = nameInput || 'GUEST';
        document.getElementById('namePrompt').classList.remove('active');
        SFX.click();
        initSystem(userName);
    };

    window.initSystem = async function(userName) {
        const profile = syncDeviceMotionProfile();
        const mobileFast = profile.mobile;
        const lowEndFast = profile.lowEnd;
        const loginView = document.getElementById('login-view');
        const mainView = document.getElementById('main-view');
        const loadingScreen = document.getElementById('loadingScreen');
        const termOut = document.getElementById('terminalOutput');
        const loadBar = document.getElementById('loadBar');
        const loginHeaderStatus = document.getElementById('loginHeaderStatus');

        loginView.style.opacity = '0'; loginView.style.pointerEvents = 'none';
        setTimeout(() => { loginView.style.display = 'none'; }, lowEndFast ? 260 : 800);

        loadingScreen.classList.add('active');
        termOut.innerHTML = ''; loadBar.style.width = '0%';
        setPremiumLoaderState('loadingScreen', 'Preparing secure handoff...', 0, 'START');
        if (loginHeaderStatus) loginHeaderStatus.innerText = ' [AUTHENTICATING...]';

        // Random easter egg check
        const rand = Math.random() * 100;
        const eggs = sysConfig.eggs || {};
        const chance = (key, fallback) => {
            const value = Number.parseInt(eggs[key] ?? fallback, 10);
            return Math.max(0, Math.min(20, Number.isFinite(value) ? value : fallback));
        };
        const eggChances = {
            virus: chance('virus', 3),
            glitch: chance('glitch', 5),
            void: chance('void', 1),
            meltdown: chance('meltdown', 2)
        };
        let threshold = eggChances.virus;
        if (rand < threshold) {
            const phase = Math.floor(Math.random() * 3);
            if (phase === 0) { await executeVirusPhase1(userName); return; }
            if (phase === 1) { await executeVirusPhase2(userName); return; }
            await executeFinalDestruction(userName); return;
        }
        threshold += eggChances.glitch;
        if (rand < threshold) {
            triggerGlitchEvent();
            await sleep(520);
        } else {
            threshold += eggChances.void;
            if (rand < threshold) {
                await triggerVoidEvent();
            } else {
                threshold += eggChances.meltdown;
                if (rand < threshold) {
                    await executeMeltdownEvent(userName);
                    return;
                }
            }
        }

        await sleep(mobileFast ? 220 : 420);
        const sequenceLogs = [
            { text: `> LINKING VISITOR PROFILE: ${userName.toUpperCase()}`, pct: 14, step: 'IDENTITY' },
            { text: '> SYNCING PROJECT PANELS... [OK]', pct: 31, step: 'PROJECTS' },
            { text: '> LOADING PREMIUM INTERFACE SKIN... [OK]', pct: 48, step: 'UI' },
            { text: '> DECRYPTING CMS PAYLOAD...', pct: 66, step: 'CMS' },
            { text: '> WARMING MOTION SYSTEMS... [OK]', pct: 82, step: 'MOTION' },
            { text: `> ACCESS GRANTED. WELCOME, ${userName}.`, pct: 100, step: 'ONLINE' }
        ];

        for (const item of sequenceLogs) {
            addPremiumLoaderLine(termOut, item.text);
            loadBar.style.width = item.pct + '%';
            setPremiumLoaderState('loadingScreen', item.text.replace(/^>\s*/, ''), item.pct, item.step);
            triggerHaptic('load_tick'); SFX.loginTick();
            await sleep((lowEndFast ? 70 : (mobileFast ? 135 : 260)) + Math.random() * (lowEndFast ? 45 : (mobileFast ? 90 : 210)));
        }

        if (loginHeaderStatus) loginHeaderStatus.innerText = ' [ONLINE]';
        triggerHaptic('success'); SFX.success();
        await sleep(mobileFast ? 420 : 800);

        if (uiElements.length === 0) {
            try {
                if (window.db_loadCMS) {
                    const cmsData = await window.db_loadCMS('main_portfolio');
                    if (cmsData) {
                        window.adminData = Object.assign({}, window.adminData, cmsData);
                        if (window.cleanLegacyCmsCopy) window.cleanLegacyCmsCopy(window.adminData);
                        if (Array.isArray(window.adminData.uiBuilder) && window.adminData.uiBuilder.length > 0) {
                            uiElements = window.adminData.uiBuilder;
                            sysLog('FIREBASE', 'Saved layout loaded from database');
                        } else {
                            uiElements = window.getDefaultUIElements();
                            sysLog('SYSTEM', 'No saved layout - applying default layout');
                        }
                    } else {
                        uiElements = window.getDefaultUIElements();
                        sysLog('SYSTEM', 'No saved CMS - applying default layout');
                    }
                } else {
                    uiElements = window.getDefaultUIElements();
                    sysLog('SYSTEM', 'DB not ready — applying default layout');
                }
            } catch(e) {
                uiElements = window.getDefaultUIElements();
                sysLog('ERROR', 'CMS load failed — falling back to default: ' + e.message);
            }
        }

        setPremiumLoaderState('loadingScreen', 'Finalizing viewport...', 96, 'FINAL');
        await sleep(mobileFast ? 120 : 220);
        if (window.applyTitleEditorData) applyTitleEditorData();
        setPremiumLoaderState('loadingScreen', 'Portfolio ready.', 100, 'READY');
        await sleep(mobileFast ? 100 : 180);
        loadingScreen.classList.remove('active');
        mainView.style.display = 'block';
        void mainView.offsetWidth;
        if (window.renderUIElements) renderUIElements();
        setTimeout(() => {
            mainView.style.opacity = '1';
            mainView.style.pointerEvents = 'auto';
            // Restore the admin toolbar after the main view loads.
            if (sessionStorage.getItem('admin_auth') === 'true') applyAdminToolbarBtn();
            // Start reveal effects for the top bar and ticker.
            mainView.querySelectorAll('.reveal').forEach(el => {
                if (window.scrollObserver) window.scrollObserver.observe(el);
            });
            // Show the feedback button after the main view appears.
            const fb = document.getElementById('section-feedback');
            if (fb) setTimeout(() => { fb.style.opacity = '1'; }, 800);
        }, lowEndFast ? 40 : 100);
    };

    window.systemLogout = async function() {
        uiElements = []; window.adminData.uiBuilder = [];
        const mainView = document.getElementById('main-view');
        const loginView = document.getElementById('login-view');
        const shutdownScreen = document.getElementById('shutdownScreen');
        const termOut = document.getElementById('shutdownOutput');

        SFX.shutdown(); triggerHaptic('heavy');
        shutdownScreen.classList.add('active');
        termOut.innerHTML = '';
        const shutdownSteps = [
            { text: '> CLOSING ACTIVE PANELS...', pct: 18, step: 'PANELS' },
            { text: '> FLUSHING MEMORY CACHE... [OK]', pct: 38, step: 'CACHE' },
            { text: '> REVOKING ACCESS TOKENS... [OK]', pct: 58, step: 'TOKENS' },
            { text: '> DISCONNECTING SESSION BUS... [OK]', pct: 78, step: 'LINK' },
            { text: '> SESSION TERMINATED. GOODBYE.', pct: 100, step: 'HALT' }
        ];
        for (const item of shutdownSteps) {
            addPremiumLoaderLine(termOut, item.text, item.pct === 100 ? 'premium-term-success' : '');
            setPremiumLoaderState('shutdownScreen', item.text.replace(/^>\s*/, ''), item.pct, item.step);
            SFX.loginTick();
            await sleep(item.pct === 100 ? 520 : 360);
        }
        triggerHaptic('error');

        // CRT shutdown effect.
        const crtCvs = document.createElement('canvas');
        crtCvs.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:20000;pointer-events:none;display:block;';
        const CW = window.innerWidth, CH = window.innerHeight;
        crtCvs.width = CW; crtCvs.height = CH;
        document.documentElement.appendChild(crtCvs);
        const cc = crtCvs.getContext('2d');

        // Pull theme primary colour for the glow tint
        const cs2 = getComputedStyle(document.documentElement);
        const pRgb = (cs2.getPropertyValue('--c-prim-rgb') || '6,182,212').trim();

        SFX.crtPowerOff();

        // Hide everything behind the canvas NOW (canvas is z-index 20000, covers all)
        // so nothing flashes when we remove the canvas at the end
        shutdownScreen.style.transition = 'none';
        shutdownScreen.classList.remove('active');
        shutdownScreen.style.opacity = '0';
        mainView.style.transition = 'none';
        mainView.style.opacity = '0';
        mainView.style.pointerEvents = 'none';

        function crtEaseOut(v) { return 1 - Math.pow(1 - v, 3); }
        function crtEaseIn(v) { return v * v * v; }
        function drawCrtField(alpha = 1, drift = 0) {
            cc.fillStyle = '#000';
            cc.fillRect(0, 0, CW, CH);

            const glow = cc.createRadialGradient(CW / 2, CH / 2, 0, CW / 2, CH / 2, Math.max(CW, CH) * 0.62);
            glow.addColorStop(0, `rgba(${pRgb},${0.18 * alpha})`);
            glow.addColorStop(0.34, `rgba(255,255,255,${0.035 * alpha})`);
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            cc.fillStyle = glow;
            cc.fillRect(0, 0, CW, CH);

            cc.save();
            cc.globalAlpha = 0.12 * alpha;
            cc.strokeStyle = `rgba(${pRgb},0.52)`;
            cc.lineWidth = 1;
            const step = 8;
            for (let y = (drift % step) - step; y < CH; y += step) {
                cc.beginPath();
                cc.moveTo(0, y);
                cc.lineTo(CW, y);
                cc.stroke();
            }
            cc.restore();
        }

        // Phase 1 - phosphor bloom, static, then vertical compression.
        await new Promise(res => {
            let st = null;
            const DUR1 = 680;
            function phase1(ts) {
                if (!st) st = ts;
                const t = Math.min((ts - st) / DUR1, 1);
                const ease = crtEaseIn(t);
                const bandH = Math.max(CH * Math.pow(1 - ease, 1.72), 5);
                const bandY = (CH - bandH) / 2 + Math.sin(ts * 0.045) * (1 - t) * 2.2;
                const centerY = CH / 2;

                cc.clearRect(0, 0, CW, CH);
                drawCrtField(1 - t * 0.36, ts * 0.04);

                const band = cc.createLinearGradient(0, bandY, 0, bandY + bandH);
                band.addColorStop(0, 'rgba(0,0,0,0)');
                band.addColorStop(0.18, `rgba(${pRgb},${0.12 + t * 0.20})`);
                band.addColorStop(0.50, `rgba(255,255,255,${0.08 + t * 0.48})`);
                band.addColorStop(0.82, `rgba(${pRgb},${0.10 + t * 0.18})`);
                band.addColorStop(1, 'rgba(0,0,0,0)');
                cc.fillStyle = band;
                cc.fillRect(0, bandY, CW, bandH);

                const coreH = Math.max(2, 12 * (1 - t) + 2);
                cc.fillStyle = `rgba(255,255,255,${0.22 + t * 0.70})`;
                cc.fillRect(0, centerY - coreH / 2, CW, coreH);
                cc.fillStyle = `rgba(239,68,68,${0.12 * (1 - t)})`;
                cc.fillRect(0, centerY - coreH / 2 - 2, CW, 1);
                cc.fillStyle = `rgba(${pRgb},${0.30 * (1 - t)})`;
                cc.fillRect(0, centerY + coreH / 2 + 2, CW, 1);

                const noiseCount = Math.round((80 + 120 * (1 - t)) * Math.min(1, CW / 1200));
                for (let i = 0; i < noiseCount; i++) {
                    const x = Math.random() * CW;
                    const y = bandY + Math.random() * bandH;
                    cc.fillStyle = `rgba(255,255,255,${Math.random() * 0.20 * (1 - t)})`;
                    cc.fillRect(x, y, 1 + Math.random() * 2, 1);
                }

                if (t < 1) requestAnimationFrame(phase1);
                else res();
            }
            requestAnimationFrame(phase1);
        });

        // Phase 2 - chromatic horizontal line collapse.
        await new Promise(res => {
            let st = null;
            const DUR2 = 760;
            function phase2(ts) {
                if (!st) st = ts;
                const t = Math.min((ts - st) / DUR2, 1);
                const ease = crtEaseOut(t);
                const lineW = Math.max(0, CW * (1 - ease));
                const lineH = Math.max(1, 7 * (1 - t) + 1);
                const lx = (CW - lineW) / 2;
                const ly = CH / 2 - lineH / 2;

                cc.clearRect(0, 0, CW, CH);
                drawCrtField(0.42 * (1 - t), ts * 0.06);

                if (lineW > 0.5) {
                    const haloH = 84 * (1 - t) + 10;
                    const halo = cc.createLinearGradient(0, ly - haloH, 0, ly + haloH);
                    halo.addColorStop(0, 'rgba(0,0,0,0)');
                    halo.addColorStop(0.5, `rgba(${pRgb},${0.28 * (1 - t)})`);
                    halo.addColorStop(1, 'rgba(0,0,0,0)');
                    cc.fillStyle = halo;
                    cc.fillRect(lx, ly - haloH, lineW, haloH * 2);

                    const lg = cc.createLinearGradient(lx, 0, lx + lineW, 0);
                    lg.addColorStop(0, 'rgba(255,255,255,0)');
                    lg.addColorStop(0.10, 'rgba(255,255,255,0.88)');
                    lg.addColorStop(0.50, 'rgba(255,255,255,1)');
                    lg.addColorStop(0.90, 'rgba(255,255,255,0.88)');
                    lg.addColorStop(1, 'rgba(255,255,255,0)');

                    cc.fillStyle = `rgba(239,68,68,${0.48 * (1 - t)})`;
                    cc.fillRect(lx - 2, ly - 3, lineW, 1);
                    cc.fillStyle = `rgba(${pRgb},${0.62 * (1 - t)})`;
                    cc.fillRect(lx + 2, ly + lineH + 3, lineW, 1);
                    cc.fillStyle = lg;
                    cc.fillRect(lx, ly, lineW, lineH);
                }

                if (t < 1) requestAnimationFrame(phase2);
                else res();
            }
            requestAnimationFrame(phase2);
        });

        // Phase 3 - final phosphor dot fade.
        await new Promise(res => {
            let st = null;
            const DUR3 = 360;
            function phase3(ts) {
                if (!st) st = ts;
                const t = Math.min((ts - st) / DUR3, 1);
                const r = Math.max(0, 18 * (1 - t));
                cc.clearRect(0, 0, CW, CH);
                cc.fillStyle = '#000';
                cc.fillRect(0, 0, CW, CH);
                if (r > 0.4) {
                    const dot = cc.createRadialGradient(CW / 2, CH / 2, 0, CW / 2, CH / 2, r * 5);
                    dot.addColorStop(0, `rgba(255,255,255,${0.92 * (1 - t)})`);
                    dot.addColorStop(0.26, `rgba(${pRgb},${0.42 * (1 - t)})`);
                    dot.addColorStop(1, 'rgba(0,0,0,0)');
                    cc.fillStyle = dot;
                    cc.beginPath();
                    cc.arc(CW / 2, CH / 2, r * 5, 0, Math.PI * 2);
                    cc.fill();
                }
                if (t < 1) requestAnimationFrame(phase3);
                else {
                    cc.clearRect(0, 0, CW, CH);
                    res();
                }
            }
            requestAnimationFrame(phase3);
        });

        // Clean up CRT canvas
        crtCvs.remove();
        shutdownScreen.style.opacity = '';

        // Transition main → login (main is already opacity:0 from above, just hide it from layout)
        mainView.style.display = 'none';

        loginView.style.display = 'flex';
        loginView.style.opacity = '0';
        loginView.style.pointerEvents = 'none';
        void loginView.offsetWidth;
        setTimeout(() => {
            loginView.style.transition = 'opacity 1s ease';
            loginView.style.opacity = '1';
            loginView.style.pointerEvents = 'auto';
            loadLoginChangelogs();
        }, 100);
    };

    window.triggerHaptic = function(type) {
        if (!navigator.vibrate) return;
        if (type === 'tap') navigator.vibrate(10);
        if (type === 'load_tick') navigator.vibrate(5);
        if (type === 'success') navigator.vibrate([10, 30, 20]);
        if (type === 'error') navigator.vibrate([50, 50, 50]);
        if (type === 'heavy') navigator.vibrate(100);
    };

    window.resetLoaderToNormal = function() {
        document.body.classList.remove('hacked-mode');
        const loadBar = document.getElementById("loadBar");
        if (loadBar) { loadBar.style.background = ""; loadBar.style.boxShadow = ""; }
    };

    window.toggleSettings = function(id) {
        const panel = document.getElementById(id);
        if (!panel) return;
        if (panel.classList.contains('show')) {
            panel.classList.remove('show');
            SFX.click();
        } else {
            document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('show'));
            panel.classList.add('show');
            SFX.click();
        }
    };

    window.setTheme = function(theme) {
        document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
        if (theme !== 'default') document.body.classList.add('theme-' + theme);
        localStorage.setItem('user_theme', theme);
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.theme-${theme}-btn`);
        if (btn) btn.classList.add('active');
        else if (theme === 'default') document.querySelector('.theme-default-btn')?.classList.add('active');
    };

    const CURSOR_STYLES = ['orbit', 'crosshair', 'prism', 'comet'];
    window.setCursorStyle = function(style) {
        const nextStyle = CURSOR_STYLES.includes(style) ? style : 'orbit';
        document.documentElement.dataset.cursorStyle = nextStyle;
        localStorage.setItem('cursor_style', nextStyle);
        document.querySelectorAll('.cursor-style-btn[data-cursor-style]').forEach(btn => {
            const active = btn.dataset.cursorStyle === nextStyle;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        const status = document.getElementById('cursorStatusText');
        if (status) status.textContent = nextStyle.toUpperCase() + ' CURSOR';
    };
    window.setCursorStyle(localStorage.getItem('cursor_style') || 'orbit');

    window.toggleManualPerf = function() {
        manualPerf = !manualPerf;
        document.body.classList.toggle('perf-mode', manualPerf);
        const pt = document.getElementById('perfStatusText');
        if (pt) pt.innerText = manualPerf ? 'PERFORMANCE MODE: ON' : 'NORMAL MODE';
    };

    // ======================================================
    // Intro animation
    // ======================================================
    function startBootAnimation() {
        const canvas = document.getElementById('boot-canvas');
        if (!canvas) return;

        const motionProfile = syncDeviceMotionProfile();
        const mobileBoot = motionProfile.mobile;
        const lowEndBoot = motionProfile.lowEnd;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const dpr = lowEndBoot
            ? maxLongSideDpr(W, H, 1080, 1.4)
            : fullHdCappedDpr(W, H, mobileBoot ? 2.25 : 2.5);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';

        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const cx = W / 2;
        const cy = H / 2;
        const cs = getComputedStyle(document.documentElement);
        const primRgb = (cs.getPropertyValue('--c-prim-rgb') || '6,182,212').trim();
        const secRgb = (cs.getPropertyValue('--c-sec-rgb') || '34,197,94').trim();
        const accRgb = (cs.getPropertyValue('--c-acc-rgb') || '209,250,229').trim();
        const prim = `rgb(${primRgb})`;
        const sec = `rgb(${secRgb})`;
        const title = (window.adminData?.textEditor?.['cms-hero-title'] || document.getElementById('title')?.textContent || 'JoshRTX').trim();
        const introText = window.adminData?.textEditor || {};
        const bootText = (key, fallback) => {
            const value = String(introText[key] || fallback || '').trim();
            return value || fallback;
        };
        const bootCopy = {
            frame: bootText('cms-intro-boot-frame', 'JOSHRTX.PORTFOLIO'),
            logo: bootText('cms-intro-boot-logo', 'JR'),
            panel: bootText('cms-intro-boot-panel', 'SYSTEM HANDOFF'),
            subline: bootText('cms-intro-boot-subline', 'CODE / GAMES / PROJECTS')
        };

        const T = lowEndBoot ? {
            logoIn: 80,
            meshIn: 210,
            railIn: 320,
            stagesIn: 460,
            titleIn: 760,
            subtitleIn: 1040,
            bloom: 1760,
            endAt: 2280
        } : mobileBoot ? {
            logoIn: 160,
            meshIn: 420,
            railIn: 700,
            stagesIn: 940,
            titleIn: 1580,
            subtitleIn: 2180,
            bloom: 3340,
            endAt: 4180
        } : {
            logoIn: 220,
            meshIn: 560,
            railIn: 950,
            stagesIn: 1260,
            titleIn: 2140,
            subtitleIn: 2940,
            bloom: 4620,
            endAt: 5750
        };
        const stages = [
            bootText('cms-intro-boot-stage-1', 'Booting canvas'),
            bootText('cms-intro-boot-stage-2', 'Loading projects'),
            bootText('cms-intro-boot-stage-3', 'Tuning interface'),
            bootText('cms-intro-boot-stage-4', 'Opening portfolio')
        ];

        const particles = Array.from({ length: lowEndBoot ? 3 : (mobileBoot ? 10 : (W < 760 ? 18 : 42)) }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            r: (lowEndBoot ? 0.35 : 0.35) + Math.random() * (lowEndBoot ? 0.85 : 1.6),
            a: (lowEndBoot ? 0.08 : 0.14) + Math.random() * (lowEndBoot ? 0.18 : 0.38),
            s: (lowEndBoot ? 0.025 : 0.05) + Math.random() * (lowEndBoot ? 0.08 : 0.22)
        }));
        const mesh = Array.from({ length: lowEndBoot ? 2 : (mobileBoot ? 4 : (W < 760 ? 7 : 14)) }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            vx: (lowEndBoot ? -0.025 : -0.08) + Math.random() * (lowEndBoot ? 0.05 : 0.16),
            vy: (lowEndBoot ? -0.018 : -0.05) + Math.random() * (lowEndBoot ? 0.036 : 0.10)
        }));
        const streaks = Array.from({ length: lowEndBoot ? 1 : (mobileBoot ? 3 : (W < 760 ? 5 : 10)) }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            len: (lowEndBoot ? 70 : 80) + Math.random() * (lowEndBoot ? 90 : 180),
            speed: (lowEndBoot ? 0.22 : 0.7) + Math.random() * (lowEndBoot ? 0.42 : 1.5),
            a: (lowEndBoot ? 0.018 : 0.04) + Math.random() * (lowEndBoot ? 0.035 : 0.11)
        }));

        let startTime = null;
        let raf = null;
        let bootWakeTimer = 0;
        let stagePlayed = -1;
        let titlePlayed = false;
        let bloomPlayed = false;
        const bootFrameMs = lowEndBoot ? 50 : 33;
        const droneRef = SFX.introBed ? SFX.introBed() : SFX.bootDrone();
        const staticBootBg = buildStaticBootBackground(lowEndBoot);

        function clamp01(v) { return Math.max(0, Math.min(1, v)); }
        function smooth(v) { v = clamp01(v); return v * v * (3 - 2 * v); }
        function p(elapsed, start, dur) { return smooth((elapsed - start) / dur); }
        function roundedRect(x, y, w, h, r) {
            const rr = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + rr, y);
            ctx.arcTo(x + w, y, x + w, y + h, rr);
            ctx.arcTo(x + w, y + h, x, y + h, rr);
            ctx.arcTo(x, y + h, x, y, rr);
            ctx.arcTo(x, y, x + w, y, rr);
            ctx.closePath();
        }
        function buildStaticBootBackground(includeGrid) {
            const bgCanvas = document.createElement('canvas');
            bgCanvas.width = W;
            bgCanvas.height = H;
            const bgCtx = bgCanvas.getContext('2d');
            const bg = bgCtx.createLinearGradient(0, 0, W, H);
            bg.addColorStop(0, '#020506');
            bg.addColorStop(0.44, '#050914');
            bg.addColorStop(1, '#020302');
            bgCtx.fillStyle = bg;
            bgCtx.fillRect(0, 0, W, H);

            const glow = bgCtx.createRadialGradient(cx, cy * 0.88, 0, cx, cy, Math.max(W, H) * 0.62);
            glow.addColorStop(0, `rgba(${primRgb},${includeGrid ? 0.14 : 0.17})`);
            glow.addColorStop(includeGrid ? 0.48 : 0.44, `rgba(${secRgb},${includeGrid ? 0.055 : 0.07})`);
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            bgCtx.fillStyle = glow;
            bgCtx.fillRect(0, 0, W, H);

            if (includeGrid) {
                bgCtx.save();
                bgCtx.globalAlpha = 0.055;
                bgCtx.strokeStyle = `rgb(${primRgb})`;
                bgCtx.lineWidth = 1;
                const grid = 72;
                for (let x = 0; x < W + grid; x += grid) {
                    bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, H); bgCtx.stroke();
                }
                for (let y = 0; y < H + grid; y += grid) {
                    bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(W, y); bgCtx.stroke();
                }
                bgCtx.restore();
            }
            return bgCanvas;
        }

        function drawBackground(elapsed) {
            ctx.drawImage(staticBootBg, 0, 0, W, H);
            if (lowEndBoot) {
                particles.forEach(pt => {
                    pt.y -= pt.s * 0.22;
                    if (pt.y < -4) { pt.y = H + 4; pt.x = Math.random() * W; }
                    ctx.save();
                    ctx.globalAlpha = pt.a * 0.32;
                    ctx.fillStyle = `rgba(${accRgb},0.8)`;
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, Math.max(0.6, pt.r), 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                });
                return;
            }

            ctx.save();
            ctx.globalAlpha = 0.075;
            ctx.strokeStyle = `rgb(${primRgb})`;
            ctx.lineWidth = 1;
            const grid = 54;
            const offset = (elapsed * 0.018) % grid;
            for (let x = -grid + offset; x < W + grid; x += grid) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            }
            for (let y = -grid + offset; y < H + grid; y += grid) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
            }
            ctx.restore();

            particles.forEach(pt => {
                pt.y -= pt.s;
                if (pt.y < -4) { pt.y = H + 4; pt.x = Math.random() * W; }
                ctx.save();
                ctx.globalAlpha = pt.a * (0.62 + 0.38 * Math.sin(elapsed * 0.002 + pt.x));
                ctx.fillStyle = '#ffffff';
                ctx.shadowColor = prim;
                ctx.shadowBlur = mobileBoot ? 3 : 6;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });
        }

        function drawStreaks(elapsed) {
            const vis = p(elapsed, T.meshIn, 900) * (lowEndBoot ? 0.42 : 1);
            if (vis <= 0) return;
            ctx.save();
            streaks.forEach(s => {
                s.x += s.speed;
                s.y -= s.speed * 0.24;
                if (s.x - s.len > W || s.y < -40) {
                    s.x = -s.len;
                    s.y = Math.random() * H;
                }
                const grad = ctx.createLinearGradient(s.x, s.y, s.x + s.len, s.y - s.len * 0.24);
                grad.addColorStop(0, 'rgba(0,0,0,0)');
                grad.addColorStop(0.5, `rgba(${primRgb},${s.a * vis})`);
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.strokeStyle = grad;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(s.x + s.len, s.y - s.len * 0.24);
                ctx.stroke();
            });
            ctx.restore();
        }

        function drawMesh(elapsed) {
            const vis = p(elapsed, T.meshIn, 900) * (lowEndBoot ? 0.35 : 1);
            if (vis <= 0) return;
            ctx.save();
            mesh.forEach(a => {
                a.x += a.vx; a.y += a.vy;
                if (a.x < -20) a.x = W + 20;
                if (a.x > W + 20) a.x = -20;
                if (a.y < -20) a.y = H + 20;
                if (a.y > H + 20) a.y = -20;
            });
            for (let i = 0; i < mesh.length; i++) {
                for (let j = i + 1; j < mesh.length; j++) {
                    const a = mesh[i], b = mesh[j];
                    const dx = a.x - b.x, dy = a.y - b.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const linkDist = lowEndBoot ? 130 : 180;
                    if (dist > linkDist) continue;
                    ctx.globalAlpha = (1 - dist / linkDist) * (lowEndBoot ? 0.08 : 0.16) * vis;
                    ctx.strokeStyle = `rgb(${primRgb})`;
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                }
            }
            mesh.forEach(pt => {
                ctx.globalAlpha = (lowEndBoot ? 0.22 : 0.35) * vis;
                ctx.fillStyle = sec;
                ctx.shadowColor = sec;
                ctx.shadowBlur = lowEndBoot ? 0 : (mobileBoot ? 5 : 10);
                ctx.beginPath(); ctx.arc(pt.x, pt.y, lowEndBoot ? 1.4 : 2.2, 0, Math.PI * 2); ctx.fill();
            });
            ctx.restore();
        }

        function drawRails(elapsed) {
            const vis = p(elapsed, T.railIn, 700);
            if (vis <= 0) return;
            const left = Math.max(24, W * 0.12);
            const right = W - left;
            const top = Math.max(72, H * 0.16);
            const bottom = H - Math.max(72, H * 0.13);
            ctx.save();
            ctx.globalAlpha = vis;
            ctx.strokeStyle = `rgba(${primRgb},0.28)`;
            ctx.lineWidth = 1;
            ctx.shadowColor = prim;
            ctx.shadowBlur = lowEndBoot ? 0 : 10;
            ctx.beginPath();
            ctx.moveTo(left, top);
            ctx.lineTo(left + 120 * vis, top);
            ctx.moveTo(right, top);
            ctx.lineTo(right - 120 * vis, top);
            ctx.moveTo(left, bottom);
            ctx.lineTo(left + 120 * vis, bottom);
            ctx.moveTo(right, bottom);
            ctx.lineTo(right - 120 * vis, bottom);
            ctx.stroke();
            ctx.restore();
        }

        function drawPremiumFrame(elapsed) {
            const vis = p(elapsed, T.railIn, 900);
            if (vis <= 0) return;
            const pad = Math.max(18, Math.min(W, H) * 0.045);
            ctx.save();
            ctx.globalAlpha = 0.75 * vis;
            ctx.strokeStyle = `rgba(${primRgb},0.13)`;
            ctx.lineWidth = 1;
            roundedRect(pad, pad, W - pad * 2, H - pad * 2, 12);
            ctx.stroke();
            ctx.font = '10px "Courier New", monospace';
            ctx.fillStyle = `rgba(${accRgb},0.36)`;
            ctx.textAlign = 'left';
            ctx.fillText(bootCopy.frame.toUpperCase(), pad + 18, pad + 26);
            ctx.textAlign = 'right';
            ctx.globalAlpha *= 0.55;
            ctx.beginPath();
            ctx.moveTo(W - pad - 86, pad + 23);
            ctx.lineTo(W - pad - 18, pad + 23);
            ctx.strokeStyle = `rgba(${primRgb},0.34)`;
            ctx.stroke();
            ctx.restore();
        }

        function drawLogo(elapsed) {
            const show = p(elapsed, T.logoIn, 900);
            if (show <= 0) return;
            const y = cy - 68;
            const ring = lowEndBoot ? 82 + show * 10 : 82 + show * 22 + Math.sin(elapsed * 0.002) * 3;
            ctx.save();
            ctx.translate(cx, y);
            ctx.globalAlpha = show;
            ctx.shadowColor = prim;
            ctx.shadowBlur = lowEndBoot ? 0 : (mobileBoot ? 14 : 24);
            ctx.strokeStyle = `rgba(${primRgb},0.44)`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            const spinA = lowEndBoot ? 0 : elapsed * 0.00016;
            const spinB = lowEndBoot ? 0 : elapsed * 0.0002;
            ctx.arc(0, 0, ring, -Math.PI * 0.12 + spinA, Math.PI * 1.62 + spinA);
            ctx.stroke();
            ctx.strokeStyle = `rgba(${secRgb},0.32)`;
            ctx.beginPath();
            ctx.arc(0, 0, ring + 19, Math.PI * 0.25 - spinB, Math.PI * 1.08 - spinB);
            ctx.stroke();

            const size = 46 + show * 20;
            roundedRect(-size / 2, -size / 2, size, size, 15);
            ctx.fillStyle = `rgba(${primRgb},0.09)`;
            ctx.fill();
            ctx.strokeStyle = `rgba(${primRgb},0.68)`;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.font = '900 23px "Courier New", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = `rgb(${accRgb})`;
            ctx.fillText(bootCopy.logo.slice(0, 8).toUpperCase(), 0, 1);
            ctx.restore();
        }

        function drawStageText(elapsed) {
            const totalP = clamp01(elapsed / T.endAt);
            const active = Math.min(stages.length - 1, Math.floor(totalP * stages.length));
            if (active > stagePlayed) {
                stagePlayed = active;
                if (SFX.introStep) SFX.introStep(active);
                else SFX.loginTick();
            }
            const fade = p(elapsed, T.stagesIn, 650);
            if (fade <= 0) return;
            const w = Math.min(660, W * 0.78);
            const h = W < 760 ? 82 : 96;
            const x = cx - w / 2;
            const y = H - Math.max(118, H * 0.17);
            ctx.save();
            ctx.globalAlpha = fade;
            ctx.shadowColor = prim;
            ctx.shadowBlur = lowEndBoot ? 0 : (mobileBoot ? 12 : 22);
            roundedRect(x, y, w, h, 10);
            const panel = ctx.createLinearGradient(x, y, x, y + h);
            panel.addColorStop(0, 'rgba(255,255,255,0.055)');
            panel.addColorStop(1, 'rgba(0,8,12,0.58)');
            ctx.fillStyle = panel;
            ctx.fill();
            ctx.strokeStyle = `rgba(${primRgb},0.34)`;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.shadowBlur = 0;

            ctx.font = '10px "Courier New", monospace';
            ctx.textAlign = 'left';
            ctx.fillStyle = `rgba(${accRgb},0.54)`;
            ctx.fillText(bootCopy.panel.toUpperCase(), x + 18, y + 24);
            ctx.textAlign = 'right';
            ctx.fillStyle = `rgba(${accRgb},0.72)`;
            ctx.fillText(String(Math.floor(totalP * 100)).padStart(2, '0') + '%', x + w - 18, y + 24);

            ctx.textAlign = 'left';
            ctx.font = '700 13px "Courier New", monospace';
            ctx.fillStyle = `rgba(${accRgb},0.92)`;
            ctx.fillText(stages[active].toUpperCase(), x + 18, y + 48);

            const barX = x + 18;
            const barY = y + h - 25;
            const barW = w - 36;
            roundedRect(barX, barY, barW, 5, 3);
            ctx.fillStyle = `rgba(${primRgb},0.16)`;
            ctx.fill();
            roundedRect(barX, barY, barW * totalP, 5, 3);
            const grad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
            grad.addColorStop(0, sec);
            grad.addColorStop(0.55, '#ffffff');
            grad.addColorStop(1, prim);
            ctx.fillStyle = grad;
            ctx.shadowColor = prim;
            ctx.shadowBlur = lowEndBoot ? 0 : 16;
            ctx.fill();
            ctx.restore();
        }

        function drawTitle(elapsed) {
            const show = p(elapsed, T.titleIn, 950);
            if (show <= 0) return;
            if (!titlePlayed && show > 0.35) {
                titlePlayed = true;
                if (SFX.introTitle) SFX.introTitle();
                else SFX.bootTitleReveal();
            }
            const y = cy + 76 - (1 - show) * 18;
            const fontSize = Math.min(W * 0.118, 92);
            ctx.save();
            ctx.globalAlpha = show;
            ctx.font = `900 ${fontSize}px "Poppins", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = prim;
            ctx.shadowBlur = lowEndBoot ? 0 : (mobileBoot ? 10 : 18) * show;
            const grad = ctx.createLinearGradient(cx - 240, y, cx + 240, y);
            grad.addColorStop(0, sec);
            grad.addColorStop(0.52, '#ffffff');
            grad.addColorStop(1, prim);
            if (!lowEndBoot) {
                ctx.fillStyle = `rgba(${secRgb},0.26)`;
                ctx.fillText(title, cx - 2.5, y + 1.5);
                ctx.fillStyle = `rgba(${primRgb},0.26)`;
                ctx.fillText(title, cx + 2.5, y - 1.5);
            }
            ctx.fillStyle = grad;
            ctx.fillText(title, cx, y);
            const subShow = p(elapsed, T.subtitleIn, 700);
            ctx.shadowBlur = 0;
            ctx.font = '11px "Courier New", monospace';
            ctx.fillStyle = `rgba(${accRgb},${0.60 * subShow})`;
            ctx.fillText(bootCopy.subline.toUpperCase(), cx, y + fontSize * 0.64);
            ctx.restore();
        }

        function drawBloom(elapsed) {
            const show = p(elapsed, T.bloom, 680);
            if (show <= 0) return;
            if (!bloomPlayed) {
                bloomPlayed = true;
                if (SFX.introBloom) SFX.introBloom();
                else SFX.bootComplete();
            }
            ctx.save();
            ctx.globalAlpha = (1 - show) * (lowEndBoot ? 0.34 : 0.58);
            const r = show * Math.max(W, H) * 0.74;
            const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            bloom.addColorStop(0, 'rgba(255,255,255,0.84)');
            bloom.addColorStop(0.22, `rgba(${primRgb},0.34)`);
            bloom.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = bloom;
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }

        function finish() {
            if (SFX.stopDrone) SFX.stopDrone(droneRef);
            triggerHaptic('success');
            if (raf) cancelAnimationFrame(raf);
            if (bootWakeTimer) clearTimeout(bootWakeTimer);
            raf = null;
            bootWakeTimer = 0;
            canvas.style.transition = `opacity ${lowEndBoot ? 0.28 : (mobileBoot ? 0.42 : 0.75)}s ease`;
            canvas.style.opacity = '0';
            const subtextEl = document.getElementById('subtext');
            if (subtextEl) subtextEl.style.opacity = '0';
            const tg = document.getElementById('transition-glow');
            if (tg) {
                tg.style.pointerEvents = 'auto';
                tg.classList.add('glow-expand');
            }
            setTimeout(() => {
                canvas.remove();
                if (subtextEl) subtextEl.remove();
                const lv = document.getElementById('login-view');
                if (lv) {
                    lv.style.display = 'flex';
                    lv.style.opacity = '0';
                    lv.style.pointerEvents = 'none';
                    void lv.offsetWidth;
                }
                setTimeout(() => {
                    const tgEl = document.getElementById('transition-glow');
                    if (tgEl) {
                        tgEl.classList.add('glow-fade-out');
                        tgEl.style.pointerEvents = 'none';
                    }
                    if (lv) {
                        lv.style.transition = 'opacity 0.9s ease-out';
                        lv.style.opacity = '1';
                        lv.style.pointerEvents = 'auto';
                    }
                    loadLoginChangelogs();
                    setTimeout(() => { const t = document.getElementById('transition-glow'); if (t) t.remove(); }, 1000);
                }, 180);
            }, lowEndBoot ? 220 : (mobileBoot ? 320 : 520));
        }

        function scheduleBootFrame() {
            if (bootFrameMs > 0) {
                bootWakeTimer = setTimeout(() => {
                    bootWakeTimer = 0;
                    raf = requestAnimationFrame(render);
                }, Math.max(8, bootFrameMs - 8));
                return;
            }
            raf = requestAnimationFrame(render);
        }

        function render(ts) {
            raf = null;
            if (!startTime) startTime = ts;
            const elapsed = ts - startTime;
            drawBackground(elapsed);
            drawStreaks(elapsed);
            drawMesh(elapsed);
            drawRails(elapsed);
            drawPremiumFrame(elapsed);
            drawLogo(elapsed);
            drawStageText(elapsed);
            drawTitle(elapsed);
            drawBloom(elapsed);
            if (elapsed < T.endAt) scheduleBootFrame();
            else finish();
        }

        scheduleBootFrame();
    }

    function waitForIntroDb(maxWait = 2600) {
        return new Promise(resolve => {
            const started = Date.now();
            const tick = () => {
                if (window.db_loadCMS) return resolve(true);
                if (Date.now() - started >= maxWait) return resolve(false);
                setTimeout(tick, 120);
            };
            tick();
        });
    }

    function preloadIntroCMS(maxWait = 2600) {
        if (window.__introCmsReady) return window.__introCmsReady;
        window.__introCmsReady = (async () => {
            const dbReady = await waitForIntroDb(maxWait);
            if (!dbReady || !window.db_loadCMS) return false;
            try {
                const cmsData = await window.db_loadCMS('main_portfolio');
                if (!cmsData) return false;
                Object.assign(window.adminData, cmsData);
                if (window.cleanLegacyCmsCopy) window.cleanLegacyCmsCopy(window.adminData);
                if (window.applyTitleEditorData) window.applyTitleEditorData();
                return true;
            } catch(e) {
                return false;
            }
        })();
        return window.__introCmsReady;
    }

    // ======================================================
    // INIT OVERLAY — handles audio unlock + boot start
    // ======================================================
    document.addEventListener('DOMContentLoaded', () => {
        initSystemWidgets();
        const introCmsReady = preloadIntroCMS(2800);
        if (window.applyTitleEditorData) applyTitleEditorData();

        // Apply saved mute icon state before audio is unlocked
        const savedMute = localStorage.getItem('sfx_muted') === 'true';
        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) muteBtn.textContent = savedMute ? '🔇' : '🔊';

        const overlay = document.getElementById('init-overlay');
        overlay.addEventListener('click', () => {
            const profile = syncDeviceMotionProfile();
            const lowEndIntro = profile.lowEnd;
            SFX.init();
            if (SFX.introTap) SFX.introTap(); else SFX.click();
            overlay.style.transition = `opacity ${lowEndIntro ? 0.34 : 0.55}s ease`;
            overlay.style.opacity = '0';
            setTimeout(async () => {
                await Promise.race([
                    introCmsReady || Promise.resolve(false),
                    new Promise(resolve => setTimeout(resolve, lowEndIntro ? 460 : 1100))
                ]);
                overlay.remove();
                // Fade the boot canvas in from black.
                const canvas = document.getElementById('boot-canvas');
                if (canvas) { canvas.style.opacity = '0'; canvas.style.transition = `opacity ${lowEndIntro ? 0.28 : 0.5}s ease`; }
                startBootAnimation();
                if (canvas) { void canvas.offsetWidth; setTimeout(() => { canvas.style.opacity = '1'; }, 30); }
            }, lowEndIntro ? 360 : 600);
        }, { once: true });
    });

    // ======================================================
    // MODALS & VIEW FUNCTIONS
    // ======================================================
    window.openModal = function(type) {
        if (isUIBuilderActive) return;
        const m = document.getElementById("modal"), t = document.getElementById("modalTitle"), c = document.getElementById("modalContent");
        const portfolioModalDefaults = {
            games: {
                title: 'Games Hub',
                content: '<div class="portfolio-modal-copy">Games are where I study pacing, feedback, UI clarity, and how small systems keep people engaged.</div><ul class="portfolio-modal-list"><li>Roblox Studio experiments and gameplay ideas</li><li>UI references from games I enjoy</li><li>Small mechanics I want to rebuild and understand</li></ul>'
            },
            projects: {
                title: 'Project Lab',
                content: '<div class="portfolio-modal-copy">My current focus is building web experiences that feel clean, fast, and personal. This portfolio is the main live project.</div><ul class="portfolio-modal-list"><li>JoshRTX personal website with editable portfolio sections</li><li>Responsive motion, admin tools, and polished portfolio sections</li><li>Admin tools for feedback, changelogs, and UI editing</li></ul>'
            },
            books: {
                title: 'Learning Notes',
                content: '<div class="portfolio-modal-copy">This space tracks what I am learning and the lessons I want to keep.</div><ul class="portfolio-modal-list"><li>Frontend structure, layout, and responsive design</li><li>JavaScript interaction patterns</li><li>BSIT notes and ideas from class projects</li></ul>'
            },
            contact: {
                title: 'Contact',
                content: 'Send a message, idea, bug report, or collaboration note. I read these like site diagnostics.'
            },
            contributions: {
                title: 'Credits',
                content: '<div class="portfolio-modal-copy">This build is personal, but it is shaped by feedback, classmates, references, tutorials, and people who pushed me to keep improving.</div><ul class="portfolio-modal-list"><li>Design feedback and bug reports</li><li>Programming lessons and class work</li><li>Game, music, and web inspiration</li></ul>'
            }
        };
        const modalDefaults = portfolioModalDefaults[type] || { title: type.toUpperCase(), content: 'No data.' };
        const editor = (window.adminData && window.adminData.textEditor) ? window.adminData.textEditor : {};
        const legacyTitles = ['PROJECT_LISTS', 'Project_Lists', 'ACTIVE_GAMES', 'BOOKS_LOG', 'CONTACT_LINKS', 'SYSTEM_ARCHITECTS'];
        const legacyContentHints = ['Roblox Scripter (2022)', 'Web developer (This portfolio)', 'No data.'];
        let titleSource = editor[`cms-modal-${type}-title`] || modalDefaults.title;
        let contentSource = editor[`cms-modal-${type}-content`] || modalDefaults.content;
        if (legacyTitles.includes(String(titleSource).trim())) titleSource = modalDefaults.title;
        if (legacyContentHints.some(hint => String(contentSource).includes(hint))) contentSource = modalDefaults.content;
        t.innerHTML = titleSource;
        if (type === "contact") {
            const feedHTML = `<div style="margin-top:20px;border-top:1px solid rgba(var(--c-prim-rgb),0.15);padding-top:14px;"><div style="font-family:monospace;color:var(--c-prim);font-size:0.75rem;letter-spacing:1px;margin-bottom:8px;">&gt; RECENT TRANSMISSIONS</div><div id="contactMessagesFeed" style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"><p style="color:#52525b;font-family:monospace;font-size:0.75rem;">Fetching...</p></div></div>`;
            const formHTML = `<form id="contactForm" onsubmit="submitMessage(event)"><div style="margin-bottom:15px;margin-top:15px;"><label style="display:block;font-family:monospace;color:var(--c-acc);margin-bottom:5px;">[SENDER_NAME]:</label><input type="text" id="senderName" required class="name-input hover-target" style="margin-bottom:0;text-align:left;padding:10px;" placeholder="Identify yourself..."></div><div style="margin-bottom:15px;"><label style="display:block;font-family:monospace;color:var(--c-acc);margin-bottom:5px;">[COMMS_PAYLOAD]:</label><textarea id="senderMessage" required class="name-input hover-target" style="text-align:left;padding:10px;height:100px;resize:none;" placeholder="Enter transmission..."></textarea></div><button type="submit" id="msgSubmitBtn" class="btn hover-target" style="margin-top:5px;padding:10px 25px;font-size:0.9rem;">Transmit Payload</button></form><div id="formStatus" style="margin-top:15px;font-family:monospace;"></div>` + feedHTML;
            c.innerHTML = `<div style="white-space:pre-wrap;">${contentSource}</div>` + formHTML;
            if (window.db_fetchData) {
                window.db_fetchData("contact_messages").then(msgs => {
                    const feed = document.getElementById('contactMessagesFeed');
                    if (!feed) return;
                    if (!msgs || msgs.length === 0) { feed.innerHTML = '<p style="color:#52525b;font-family:monospace;font-size:0.75rem;">> No transmissions yet.</p>'; return; }
                    feed.innerHTML = msgs.slice(0, 5).map(m => `<div style="background:rgba(var(--c-prim-rgb),0.05);border:1px solid rgba(var(--c-prim-rgb),0.12);border-radius:5px;padding:7px 10px;"><div style="font-family:monospace;font-size:0.65rem;color:rgba(var(--c-prim-rgb),0.6);margin-bottom:2px;">${m.sender} · ${m.timestamp ? new Date(m.timestamp.toDate()).toLocaleString() : 'Just now'}</div><div style="font-size:0.82rem;color:#d1fae5;">${m.payload}</div></div>`).join('');
                });
            }
        } else { c.innerHTML = `<div style="white-space:pre-wrap;">${contentSource}</div>`; }
        hideToolbarForModal();
        m.classList.add("show");
        SFX.modalOpen();
        sysLog('INFO', `User viewed modal: ${type}`);
    };

    window.closeModal = function() { document.getElementById("modal").classList.remove("show"); showToolbarForModal(); SFX.modalClose(); };

    window.submitMessage = async function(event) {
        event.preventDefault();
        const name = document.getElementById("senderName").value, message = document.getElementById("senderMessage").value;
        const statusDiv = document.getElementById("formStatus"), btn = document.getElementById("msgSubmitBtn");
        btn.disabled = true; statusDiv.style.color = "var(--c-prim)"; statusDiv.innerText = "> Encrypting data packets...";
        SFX.transmitPayload();
        await sleep(400);
        if (window.db_logTransmission) {
            const result = await window.db_logTransmission("contact_messages", { sender: name, payload: message });
            if (result.success) {
                statusDiv.style.color = "var(--c-acc)"; statusDiv.innerText = `> TRANSMISSION SUCCESSFUL. ID: ${result.id.slice(0, 8).toUpperCase()}`;
                triggerHaptic('success'); SFX.success();
                document.getElementById("contactForm").reset();
                if (window.db_fetchData) {
                    window.db_fetchData("contact_messages").then(msgs => {
                        const feed = document.getElementById('contactMessagesFeed');
                        if (!feed || !msgs) return;
                        feed.innerHTML = msgs.slice(0, 5).map(m => `<div style="background:rgba(var(--c-prim-rgb),0.05);border:1px solid rgba(var(--c-prim-rgb),0.12);border-radius:5px;padding:7px 10px;"><div style="font-family:monospace;font-size:0.65rem;color:rgba(var(--c-prim-rgb),0.6);margin-bottom:2px;">${m.sender} · ${m.timestamp ? new Date(m.timestamp.toDate()).toLocaleString() : 'Just now'}</div><div style="font-size:0.82rem;color:#d1fae5;">${m.payload}</div></div>`).join('');
                    });
                }
            } else { statusDiv.style.color = "#ef4444"; statusDiv.innerText = "> UPLOAD_REJECTED: Please try again."; triggerHaptic('error'); SFX.error(); }
        }
        btn.disabled = false;
    };

    window.openFeedbackModal = function() {
        document.getElementById("fbFormContainer").style.display = "block";
        document.getElementById("fbLoadingContainer").style.display = "none";
        document.getElementById("feedbackForm").reset();
        const loadText = document.getElementById("fbLoadText"), loadBar = document.getElementById("fbLoadBar");
        if (loadText) { loadText.innerText = "Preparing feedback..."; loadText.style.color = ""; }
        if (loadBar) { loadBar.style.width = "0%"; loadBar.style.background = ""; loadBar.style.boxShadow = ""; }
        hideToolbarForModal();
        document.getElementById("feedbackModal").classList.add("show");
        SFX.modalOpen();
    };
    window.closeFeedbackModal = function() { document.getElementById("feedbackModal").classList.remove("show"); showToolbarForModal(); SFX.modalClose(); };

    window.submitFeedback = async function(event) {
        event.preventDefault();
        const message = document.getElementById("fbMessage").value;
        document.getElementById("fbFormContainer").style.display = "none";
        document.getElementById("fbLoadingContainer").style.display = "block";
        const loadText = document.getElementById("fbLoadText"), loadBar = document.getElementById("fbLoadBar");
        loadBar.style.width = "0%";
        SFX.feedbackPacking();
        for (let i = 1; i <= 5; i++) {
            loadText.innerText = `Preparing feedback... ${i * 20}%`;
            loadBar.style.width = `${i * 10}%`;
            triggerHaptic('load_tick');
            if (i === 3) SFX.feedbackPacking();
            else SFX.loginTick();
            await sleep(200);
        }
        loadText.innerText = "Sending feedback..."; loadBar.style.width = "70%";
        SFX.feedbackUplink();
        await sleep(400);
        if (window.db_logTransmission) {
            await window.db_logTransmission("system_feedback", { message, user_location: `Unknown` });
            loadText.innerText = "Feedback sent. Thank you."; loadText.style.color = "var(--c-acc)";
            loadBar.style.background = "var(--c-acc)"; loadBar.style.boxShadow = "0 0 15px var(--c-acc)";
            loadBar.style.width = "100%"; triggerHaptic('success'); SFX.feedbackSuccess();
            sysLog('INFO', 'User feedback submitted successfully');
        }
        await sleep(1500); closeFeedbackModal();
        setTimeout(() => { loadText.style.color = "#f59e0b"; loadBar.style.background = "#f59e0b"; loadBar.style.boxShadow = "0 0 15px #f59e0b"; }, 500);
    };

    let adminClickCount = 0, adminClickTimer, failedAdminAttempts = 0, lockoutTime = 0;

    window.triggerAdmin = function() {
        if (Date.now() < lockoutTime) return;
        if (sessionStorage.getItem('admin_auth') === 'true') {
            hideToolbarForModal();
            document.getElementById('adminSelectionModal').classList.add('show');
            SFX.adminOpen(); triggerHaptic('heavy');
            return;
        }
        adminClickCount++; clearTimeout(adminClickTimer);
        adminClickTimer = setTimeout(() => { adminClickCount = 0; }, 2000);
        if (adminClickCount >= 5) { document.getElementById('adminModal').classList.add('show'); adminClickCount = 0; SFX.adminOpen(); triggerHaptic('heavy'); }
    };

    function applyAdminToolbarBtn() {
        const container = document.getElementById('leftTopControls');
        if (!container) { setTimeout(applyAdminToolbarBtn, 400); return; }
        if (!document.getElementById('persistentAdminBtn')) {
            const btn = document.createElement('button');
            btn.id = 'persistentAdminBtn';
            btn.className = 'sys-settings-btn hover-target reveal active';
            btn.innerHTML = '⚙️ ADMIN PANEL';
            btn.style.cssText = 'width:auto;padding:0 15px;color:#f59e0b;border-color:#f59e0b;font-family:monospace;font-weight:bold;background:rgba(245,158,11,0.1);flex-shrink:0;white-space:nowrap;font-size:0.9rem;height:42px;border-radius:8px;box-shadow:0 0 15px rgba(245,158,11,0.2);transition:all 0.2s ease;cursor:none;margin-left:10px;';
            btn.onclick = () => { hideToolbarForModal(); document.getElementById('adminSelectionModal').classList.add('show'); SFX.adminOpen(); triggerHaptic('heavy'); };
            container.appendChild(btn);
        }
    }

    window.exitAdminMode = function() {
        sessionStorage.removeItem('admin_auth');
        const btn = document.getElementById('persistentAdminBtn');
        if (btn) btn.remove();
        document.getElementById('adminSelectionModal').classList.remove('show');
        showToolbarForModal(); renderUIElements();
        SFX.success(); triggerHaptic('success');
        sysLog('SYSTEM', 'Admin mode deactivated');
    };

    window.attemptAdminLogin = async function(event) {
        event.preventDefault();
        if (Date.now() < lockoutTime) return;
        const u = document.getElementById('adminUser').value.trim(), p = document.getElementById('adminPass').value.trim();
        const btn = document.getElementById('adminAuthBtn'); btn.innerText = "AUTHENTICATING...";
        document.getElementById('adminModal').classList.remove('show');
        const authTransScreen = document.getElementById("adminAuthTransition");
        const authTransText = document.getElementById("adminAuthText");
        const authOutput = document.getElementById("adminAuthOutput");
        const authHeader = document.getElementById("adminAuthHeaderStatus");
        authTransScreen.classList.add('active');
        authTransScreen.style.opacity = "1"; authTransScreen.style.pointerEvents = "auto";
        if (authOutput) authOutput.innerHTML = '';
        if (authHeader) authHeader.innerText = ' [HANDSHAKE]';
        SFX.transmit();
        setPremiumLoaderState('adminAuthTransition', 'Opening encrypted admin channel...', 12, 'CONNECT');
        addPremiumLoaderLine(authOutput, '> OPENING ENCRYPTED ADMIN CHANNEL...');
        await sleep(560);
        setPremiumLoaderState('adminAuthTransition', 'Checking credentials...', 34, 'SCAN');
        addPremiumLoaderLine(authOutput, '> SCANNING CREDENTIAL SIGNATURE...');
        SFX.credentialScan();
        const isAuthorized = await window.db_secureLogin(u, p); await sleep(720);
        if (isAuthorized) {
            failedAdminAttempts = 0;
            setPremiumLoaderState('adminAuthTransition', 'Decrypting root hash...', 62, 'DECRYPT');
            addPremiumLoaderLine(authOutput, '> DECRYPTING ROOT HASH...');
            await sleep(620);
            setPremiumLoaderState('adminAuthTransition', 'Mounting admin tools...', 84, 'TOOLS');
            addPremiumLoaderLine(authOutput, '> MOUNTING ADMIN WORKSPACE...');
            await sleep(520);
            setPremiumLoaderState('adminAuthTransition', 'Access granted.', 100, 'GRANTED');
            addPremiumLoaderLine(authOutput, '> ACCESS GRANTED.', 'premium-term-success');
            if (authHeader) authHeader.innerText = ' [GRANTED]';
            authTransText.classList.remove('premium-term-error');
            authTransText.classList.add('premium-term-success');
            triggerHaptic('success'); SFX.success(); await sleep(760);
            sessionStorage.setItem('admin_auth', 'true');
            applyAdminToolbarBtn(); renderUIElements();
            authTransScreen.classList.remove('active');
            authTransScreen.style.opacity = "0"; authTransScreen.style.pointerEvents = "none"; await sleep(420);
            authTransText.classList.remove('premium-term-success');
            btn.innerText = "AUTHORIZE";
            document.getElementById('adminUser').value = ''; document.getElementById('adminPass').value = '';
            hideToolbarForModal(); document.getElementById('adminSelectionModal').classList.add('show');
        } else {
            failedAdminAttempts++; triggerHaptic('error'); SFX.error();
            setPremiumLoaderState('adminAuthTransition', `Authorization failed. (${failedAdminAttempts}/3)`, 100, 'DENIED');
            addPremiumLoaderLine(authOutput, `> AUTHORIZATION FAILED. (${failedAdminAttempts}/3)`, 'premium-term-error');
            if (authHeader) authHeader.innerText = ' [DENIED]';
            authTransText.classList.add('premium-term-error');
            await sleep(1250);
            if (failedAdminAttempts >= 3) {
                setPremiumLoaderState('adminAuthTransition', 'System locked for 60 seconds.', 100, 'LOCKED');
                addPremiumLoaderLine(authOutput, '> MAXIMUM ATTEMPTS REACHED. LOCKING GATE.', 'premium-term-error');
                lockoutTime = Date.now() + 60000; failedAdminAttempts = 0; await sleep(2100);
            } else {
                setPremiumLoaderState('adminAuthTransition', 'Returning to login menu...', 26, 'RESET');
                addPremiumLoaderLine(authOutput, '> RETURNING TO LOGIN MENU...');
                await sleep(1050);
            }
            authTransScreen.classList.remove('active');
            authTransScreen.style.opacity = "0"; authTransScreen.style.pointerEvents = "none"; await sleep(420);
            authTransText.classList.remove('premium-term-error');
            btn.innerText = "AUTHORIZE"; document.getElementById('adminPass').value = '';
            if (Date.now() >= lockoutTime) document.getElementById('adminModal').classList.add('show');
        }
    };

    window.selectDashboard = async function() {
        document.getElementById('adminSelectionModal').classList.remove('show');
        hideToolbarForModal();
        document.getElementById('adminDashboardScreen').classList.add('show');
        triggerHaptic('tap'); SFX.modalOpen();
        const msgC = document.getElementById('dashMessagesContainer'), fbC = document.getElementById('dashFeedbackContainer');
        const msgCount = document.getElementById('dashMsgCount'), fbCount = document.getElementById('dashFbCount');
        const escapeDashText = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        const formatDashTime = (entry) => {
            try { return entry?.timestamp ? new Date(entry.timestamp.toDate()).toLocaleString() : 'Unknown time'; }
            catch(e) { return 'Unknown time'; }
        };
        const loading = (text, tone = '') => `<div class="premium-dash-empty ${tone}">${text}</div>`;
        msgC.innerHTML = loading('Loading contact messages...');
        fbC.innerHTML = loading('Loading feedback...');
        if (msgCount) msgCount.innerText = '--';
        if (fbCount) fbCount.innerText = '--';
        if (!window.db_fetchData) {
            msgC.innerHTML = loading('Message service unavailable.');
            fbC.innerHTML = loading('Feedback service unavailable.', 'amber');
            return;
        }
        const [messages, feedback] = await Promise.all([window.db_fetchData("contact_messages"), window.db_fetchData("system_feedback")]);
        if (msgCount) msgCount.innerText = String(messages.length);
        if (fbCount) fbCount.innerText = String(feedback.length);
        msgC.innerHTML = '';
        if (messages.length === 0) msgC.innerHTML = loading('No contact messages yet.');
        messages.forEach((msg, idx) => {
            const sender = escapeDashText(msg.sender || 'Anonymous');
            const payload = escapeDashText(msg.payload || '');
            const time = escapeDashText(formatDashTime(msg));
            msgC.innerHTML += `<article id="dashMsg_${msg.id}" class="premium-dash-card message" style="animation-delay:${idx * 0.06}s"><div class="premium-dash-card-top"><span>${time}</span><button class="premium-dash-delete hover-target" onclick="window.dashDeleteDoc('contact_messages','${msg.id}','dashMsg_${msg.id}')">Delete</button></div><h4>From ${sender}</h4><p>${payload}</p></article>`;
        });
        fbC.innerHTML = '';
        if (feedback.length === 0) fbC.innerHTML = loading('No feedback reports yet.', 'amber');
        feedback.forEach((fb, idx) => {
            const message = escapeDashText(fb.message || '');
            const time = escapeDashText(formatDashTime(fb));
            fbC.innerHTML += `<article id="dashFb_${fb.id}" class="premium-dash-card feedback" style="animation-delay:${idx * 0.06}s"><div class="premium-dash-card-top"><span>${time}</span><button class="premium-dash-delete hover-target" onclick="window.dashDeleteDoc('system_feedback','${fb.id}','dashFb_${fb.id}')">Delete</button></div><p>${message}</p></article>`;
        });
    };
    window.closeDashboard = function() { document.getElementById('adminDashboardScreen').classList.remove('show'); showToolbarForModal(); SFX.modalClose(); triggerHaptic('heavy'); };
    window.dashDeleteDoc = async function(collection, id, elemId) {
        if (!window.db_deleteDocument) return;
        const el = document.getElementById(elemId);
        if (el) { el.style.opacity = '0.3'; el.style.pointerEvents = 'none'; }
        const result = await window.db_deleteDocument(collection, id);
        if (result.success) { if (el) el.remove(); SFX.success(); triggerHaptic('success'); sysLog('ADMIN', `Deleted ${collection}/${id}`); }
        else { if (el) { el.style.opacity = '1'; el.style.pointerEvents = 'auto'; } SFX.error(); }
    };

    // ======================================================
    // ELEMENT EDITOR FILE UPLOAD
    // ======================================================
    document.getElementById('edFile').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        let elType = uiElements[editingIndex] ? uiElements[editingIndex].type : 'image';
        let mediaType = elType === 'audio' ? 'audio' : elType === 'video' ? 'video' : 'image';
        const statusLabel = document.getElementById('edUploadStatus');
        statusLabel.style.display = 'block'; statusLabel.style.color = '#f59e0b'; statusLabel.innerText = "Uploading: 0%";
        try {
            const meta = await window.db_uploadMediaFile(file, mediaType, (prog) => { statusLabel.innerText = `Uploading: ${prog.toFixed(0)}%`; });
            document.getElementById('edUrl').value = meta.secure_url;
            if (uiElements[editingIndex]) { uiElements[editingIndex].url = meta.secure_url; uiElements[editingIndex].public_id = meta.public_id; }
            sysLog('BUILDER', `Element updated with new media`);
            statusLabel.style.color = '#22c55e'; statusLabel.innerText = "Upload Complete!";
            setTimeout(() => statusLabel.style.display = 'none', 3000);
            e.target.value = "";
            renderUIElements(); await saveUIBuilder();
        } catch(err) { statusLabel.style.color = '#ef4444'; statusLabel.innerText = "Upload Failed."; SFX.error(); }
    });

    // ======================================================
    // UI BUILDER
    // ======================================================
    let isUIBuilderActive = false, uiLocked = false, pendingInsertIndex = -1, editingIndex = -1, selectedElementIndex = -1, undoSnapshot = null;

    function cleanUIElements(arr) { return arr.filter(el => el && el.id && el.type); }



    const STYLE_FIELD_IDS = ['TextColor','BgColor','BorderColor','AccentColor','FontSize','FontWeight','TextAlign','Padding','Margin','Radius','Shadow','CustomCss'];
    function getStyleInput(name) {
        const el = document.getElementById('ed' + name);
        return el ? el.value.trim() : '';
    }
    function setStyleInput(name, value) {
        const el = document.getElementById('ed' + name);
        if (el) el.value = value || '';
    }
    function readElementStyle() {
        const style = {
            textColor: getStyleInput('TextColor'),
            bgColor: getStyleInput('BgColor'),
            borderColor: getStyleInput('BorderColor'),
            accentColor: getStyleInput('AccentColor'),
            fontSize: getStyleInput('FontSize'),
            fontWeight: getStyleInput('FontWeight'),
            textAlign: getStyleInput('TextAlign'),
            padding: getStyleInput('Padding'),
            margin: getStyleInput('Margin'),
            radius: getStyleInput('Radius'),
            shadow: getStyleInput('Shadow'),
            customCss: getStyleInput('CustomCss')
        };
        Object.keys(style).forEach(key => { if (!style[key]) delete style[key]; });
        return style;
    }
    function writeElementStyle(style = {}) {
        setStyleInput('TextColor', style.textColor);
        setStyleInput('BgColor', style.bgColor);
        setStyleInput('BorderColor', style.borderColor);
        setStyleInput('AccentColor', style.accentColor);
        setStyleInput('FontSize', style.fontSize);
        setStyleInput('FontWeight', style.fontWeight);
        setStyleInput('TextAlign', style.textAlign);
        setStyleInput('Padding', style.padding);
        setStyleInput('Margin', style.margin);
        setStyleInput('Radius', style.radius);
        setStyleInput('Shadow', style.shadow);
        setStyleInput('CustomCss', style.customCss);
    }
    function applySafeStyle(target, prop, value) {
        if (!target || value === undefined || value === null || String(value).trim() === '') return;
        target.style[prop] = String(value).replace(/[<>]/g, '').trim();
    }
    function applyBuilderStyles(data, wrapper) {
        const style = data.style && typeof data.style === 'object' ? data.style : {};
        const surface = wrapper.querySelector('.builder-style-surface') || wrapper.firstElementChild || wrapper;
        applySafeStyle(wrapper, 'margin', style.margin);
        applySafeStyle(surface, 'color', style.textColor);
        applySafeStyle(surface, 'background', style.bgColor);
        applySafeStyle(surface, 'borderColor', style.borderColor);
        applySafeStyle(surface, 'fontSize', style.fontSize);
        applySafeStyle(surface, 'fontWeight', style.fontWeight);
        applySafeStyle(surface, 'textAlign', style.textAlign);
        applySafeStyle(surface, 'padding', style.padding);
        applySafeStyle(surface, 'borderRadius', style.radius);
        applySafeStyle(surface, 'boxShadow', style.shadow);
        if (style.customCss) surface.style.cssText += ';' + String(style.customCss).replace(/[<>]/g, '');
        if (style.accentColor) {
            const accent = String(style.accentColor).replace(/[<>]/g, '').trim();
            surface.style.setProperty('--builder-accent', accent);
            surface.querySelectorAll('h1,h2,h3,h4,strong,.b-status,.status-icon').forEach(el => {
                if (el.classList.contains('status-icon')) el.style.background = accent;
                else el.style.color = accent;
            });
            if (surface.matches('button,.btn')) {
                surface.style.color = accent;
                surface.style.borderColor = accent;
            }
            surface.querySelectorAll('button,.btn').forEach(btn => {
                btn.style.color = accent;
                btn.style.borderColor = accent;
            });
        }
    }



    function readTitleEditorValue(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    function setTitleEditorValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    }

    function cleanInlineCss(value) {
        return String(value || '').replace(/[<>]/g, '').trim();
    }

    window.applyTitleEditorData = function() {
        const txt = window.adminData.textEditor || {};
        const title = txt['cms-hero-title'] || 'JoshRTX';
        const startLine = txt['cms-hero-start-line'] || 'Personal Build';
        const subtitle = txt['cms-hero-subtitle'] || 'Student dev space';
        const heroTag = txt['cms-hero-tag'] || '> PERSONAL_BUILD // JOSHRTX_v4.2';
        const titleEl = document.getElementById('title');
        const ioLabel = document.querySelector('.io-label');
        const ioVersion = document.querySelector('.io-version');
        const ioSubtitle = document.querySelector('.io-subtitle');
        const heroTagEl = document.querySelector('.hero-id-tag');

        document.title = title;
        if (titleEl) {
            titleEl.textContent = title;
            titleEl.style.color = '';
            titleEl.style.background = '';
            titleEl.style.webkitTextFillColor = '';
            titleEl.style.fontSize = '';
            titleEl.style.letterSpacing = '';
            titleEl.style.textShadow = '';
            const color = cleanInlineCss(txt['cms-hero-title-color']);
            if (color) {
                titleEl.style.background = 'none';
                titleEl.style.webkitTextFillColor = color;
                titleEl.style.color = color;
            }
            const fontSize = cleanInlineCss(txt['cms-hero-title-font-size']);
            const spacing = cleanInlineCss(txt['cms-hero-title-letter-spacing']);
            const shadow = cleanInlineCss(txt['cms-hero-title-shadow']);
            const customCss = cleanInlineCss(txt['cms-hero-title-custom-css']);
            if (fontSize) titleEl.style.fontSize = fontSize;
            if (spacing) titleEl.style.letterSpacing = spacing;
            if (shadow) titleEl.style.textShadow = shadow;
            if (customCss) titleEl.style.cssText += ';' + customCss;
        }
        if (ioLabel) ioLabel.textContent = title;
        if (ioVersion) ioVersion.textContent = title + ' // ' + startLine;
        if (ioSubtitle) ioSubtitle.textContent = subtitle;
        if (heroTagEl) heroTagEl.textContent = heroTag;

        const introDefaults = {
            status1: title + ' v4.2',
            status2: 'Portfolio ready',
            status3: 'Sound unlock',
            eyebrow: 'Personal webspace',
            mark: 'JR',
            title,
            subcopy: 'Projects, games, notes, and experiments',
            spec1: 'HTML/CSS',
            spec2: 'JavaScript',
            spec3: 'Roblox Studio',
            enter: 'Tap to launch',
            footer: 'Built by Josh // personal site'
        };
        const introMap = [
            ['introStatus1Text', 'cms-intro-status-1', introDefaults.status1],
            ['introStatus2Text', 'cms-intro-status-2', introDefaults.status2],
            ['introStatus3Text', 'cms-intro-status-3', introDefaults.status3],
            ['introEyebrowText', 'cms-intro-eyebrow', introDefaults.eyebrow],
            ['introLogoMarkText', 'cms-intro-logo-mark', introDefaults.mark],
            ['introLogoTitleText', 'cms-intro-title', introDefaults.title],
            ['introSubcopyText', 'cms-intro-subcopy', introDefaults.subcopy],
            ['introSpec1Text', 'cms-intro-spec-1', introDefaults.spec1],
            ['introSpec2Text', 'cms-intro-spec-2', introDefaults.spec2],
            ['introSpec3Text', 'cms-intro-spec-3', introDefaults.spec3],
            ['introEnterText', 'cms-intro-enter', introDefaults.enter],
            ['introFooterText', 'cms-intro-footer', introDefaults.footer]
        ];
        introMap.forEach(([id, key, fallback]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = txt[key] || fallback;
        });

        const tagDefaults = ['BSIT Student', 'Gamer', 'Frontend Learner', 'Learning Developer'];
        document.querySelectorAll('.hero-tags .htag').forEach((el, index) => {
            el.textContent = txt[`cms-hero-tag-${index + 1}`] || tagDefaults[index] || '';
        });

        const statDefaults = [
            { value: '2', label: 'Projects' },
            { value: '1+', label: 'Coding' },
            { value: 'BSIT', label: 'Course' },
            { value: '', label: 'Uptime' }
        ];
        document.querySelectorAll('.hero-stats .hstat').forEach((row, index) => {
            const val = row.querySelector('.hstat-val');
            const label = row.querySelector('.hstat-lbl');
            const stat = statDefaults[index];
            if (!stat) return;
            if (index < 3 && val) val.textContent = txt[`cms-hero-stat-${index + 1}-value`] || stat.value;
            if (label) label.textContent = txt[`cms-hero-stat-${index + 1}-label`] || stat.label;
        });
    };

    window.openTitleEditor = function() {
        const txt = window.adminData.textEditor || {};
        document.getElementById('adminSelectionModal').classList.remove('show');
        hideToolbarForModal();
        setTitleEditorValue('titleMainInput', txt['cms-hero-title'] || 'JoshRTX');
        setTitleEditorValue('titleStartLineInput', txt['cms-hero-start-line'] || 'Personal Build');
        setTitleEditorValue('titleSubtitleInput', txt['cms-hero-subtitle'] || 'Student dev space');
        setTitleEditorValue('titleHeroTagInput', txt['cms-hero-tag'] || '> PERSONAL_BUILD // JOSHRTX_v4.2');
        setTitleEditorValue('introStatus1Input', txt['cms-intro-status-1'] || ((txt['cms-hero-title'] || 'JoshRTX') + ' v4.2'));
        setTitleEditorValue('introStatus2Input', txt['cms-intro-status-2'] || 'Portfolio ready');
        setTitleEditorValue('introStatus3Input', txt['cms-intro-status-3'] || 'Sound unlock');
        setTitleEditorValue('introEyebrowInput', txt['cms-intro-eyebrow'] || 'Personal webspace');
        setTitleEditorValue('introLogoMarkInput', txt['cms-intro-logo-mark'] || 'JR');
        setTitleEditorValue('introLogoTitleInput', txt['cms-intro-title'] || txt['cms-hero-title'] || 'JoshRTX');
        setTitleEditorValue('introSubcopyInput', txt['cms-intro-subcopy'] || 'Projects, games, notes, and experiments');
        setTitleEditorValue('introSpec1Input', txt['cms-intro-spec-1'] || 'HTML/CSS');
        setTitleEditorValue('introSpec2Input', txt['cms-intro-spec-2'] || 'JavaScript');
        setTitleEditorValue('introSpec3Input', txt['cms-intro-spec-3'] || 'Roblox Studio');
        setTitleEditorValue('introEnterInput', txt['cms-intro-enter'] || 'Tap to launch');
        setTitleEditorValue('introFooterInput', txt['cms-intro-footer'] || 'Built by Josh // personal site');
        setTitleEditorValue('introBootFrameInput', txt['cms-intro-boot-frame'] || 'JOSHRTX.PORTFOLIO');
        setTitleEditorValue('introBootLogoInput', txt['cms-intro-boot-logo'] || 'JR');
        setTitleEditorValue('introBootPanelInput', txt['cms-intro-boot-panel'] || 'SYSTEM HANDOFF');
        setTitleEditorValue('introBootSublineInput', txt['cms-intro-boot-subline'] || 'CODE / GAMES / PROJECTS');
        setTitleEditorValue('introBootStage1Input', txt['cms-intro-boot-stage-1'] || 'Booting canvas');
        setTitleEditorValue('introBootStage2Input', txt['cms-intro-boot-stage-2'] || 'Loading projects');
        setTitleEditorValue('introBootStage3Input', txt['cms-intro-boot-stage-3'] || 'Tuning interface');
        setTitleEditorValue('introBootStage4Input', txt['cms-intro-boot-stage-4'] || 'Opening portfolio');
        setTitleEditorValue('titleColorInput', txt['cms-hero-title-color'] || '');
        setTitleEditorValue('titleFontSizeInput', txt['cms-hero-title-font-size'] || '');
        setTitleEditorValue('titleLetterSpacingInput', txt['cms-hero-title-letter-spacing'] || '');
        setTitleEditorValue('titleShadowInput', txt['cms-hero-title-shadow'] || '');
        setTitleEditorValue('titleCustomCssInput', txt['cms-hero-title-custom-css'] || '');
        setTitleEditorValue('titleTag1Input', txt['cms-hero-tag-1'] || 'BSIT Student');
        setTitleEditorValue('titleTag2Input', txt['cms-hero-tag-2'] || 'Gamer');
        setTitleEditorValue('titleTag3Input', txt['cms-hero-tag-3'] || 'Frontend Learner');
        setTitleEditorValue('titleTag4Input', txt['cms-hero-tag-4'] || 'Learning Developer');
        setTitleEditorValue('titleProjectsValueInput', txt['cms-hero-stat-1-value'] || '2');
        setTitleEditorValue('titleProjectsLabelInput', txt['cms-hero-stat-1-label'] || 'Projects');
        setTitleEditorValue('titleCodingValueInput', txt['cms-hero-stat-2-value'] || '1+');
        setTitleEditorValue('titleCodingLabelInput', txt['cms-hero-stat-2-label'] || 'Coding');
        setTitleEditorValue('titleCourseValueInput', txt['cms-hero-stat-3-value'] || 'BSIT');
        setTitleEditorValue('titleCourseLabelInput', txt['cms-hero-stat-3-label'] || 'Course');
        setTitleEditorValue('titleUptimeLabelInput', txt['cms-hero-stat-4-label'] || 'Uptime');
        document.getElementById('titleEditorModal').classList.add('show');
        SFX.modalOpen();
    };

    window.closeTitleEditor = function() {
        document.getElementById('titleEditorModal').classList.remove('show');
        showToolbarForModal();
        SFX.modalClose();
    };

    window.saveTitleEditor = async function() {
        if (!window.adminData.textEditor) window.adminData.textEditor = {};
        const txt = window.adminData.textEditor;
        txt['cms-hero-title'] = readTitleEditorValue('titleMainInput') || 'JoshRTX';
        txt['cms-hero-start-line'] = readTitleEditorValue('titleStartLineInput') || 'Personal Build';
        txt['cms-hero-subtitle'] = readTitleEditorValue('titleSubtitleInput') || 'Student dev space';
        txt['cms-hero-tag'] = readTitleEditorValue('titleHeroTagInput') || '> PERSONAL_BUILD // JOSHRTX_v4.2';
        txt['cms-intro-status-1'] = readTitleEditorValue('introStatus1Input') || (txt['cms-hero-title'] + ' v4.2');
        txt['cms-intro-status-2'] = readTitleEditorValue('introStatus2Input') || 'Portfolio ready';
        txt['cms-intro-status-3'] = readTitleEditorValue('introStatus3Input') || 'Sound unlock';
        txt['cms-intro-eyebrow'] = readTitleEditorValue('introEyebrowInput') || 'Personal webspace';
        txt['cms-intro-logo-mark'] = readTitleEditorValue('introLogoMarkInput') || 'JR';
        txt['cms-intro-title'] = readTitleEditorValue('introLogoTitleInput') || txt['cms-hero-title'];
        txt['cms-intro-subcopy'] = readTitleEditorValue('introSubcopyInput') || 'Projects, games, notes, and experiments';
        txt['cms-intro-spec-1'] = readTitleEditorValue('introSpec1Input') || 'HTML/CSS';
        txt['cms-intro-spec-2'] = readTitleEditorValue('introSpec2Input') || 'JavaScript';
        txt['cms-intro-spec-3'] = readTitleEditorValue('introSpec3Input') || 'Roblox Studio';
        txt['cms-intro-enter'] = readTitleEditorValue('introEnterInput') || 'Tap to launch';
        txt['cms-intro-footer'] = readTitleEditorValue('introFooterInput') || 'Built by Josh // personal site';
        txt['cms-intro-boot-frame'] = readTitleEditorValue('introBootFrameInput') || 'JOSHRTX.PORTFOLIO';
        txt['cms-intro-boot-logo'] = readTitleEditorValue('introBootLogoInput') || 'JR';
        txt['cms-intro-boot-panel'] = readTitleEditorValue('introBootPanelInput') || 'SYSTEM HANDOFF';
        txt['cms-intro-boot-subline'] = readTitleEditorValue('introBootSublineInput') || 'CODE / GAMES / PROJECTS';
        txt['cms-intro-boot-stage-1'] = readTitleEditorValue('introBootStage1Input') || 'Booting canvas';
        txt['cms-intro-boot-stage-2'] = readTitleEditorValue('introBootStage2Input') || 'Loading projects';
        txt['cms-intro-boot-stage-3'] = readTitleEditorValue('introBootStage3Input') || 'Tuning interface';
        txt['cms-intro-boot-stage-4'] = readTitleEditorValue('introBootStage4Input') || 'Opening portfolio';
        txt['cms-hero-title-color'] = readTitleEditorValue('titleColorInput');
        txt['cms-hero-title-font-size'] = readTitleEditorValue('titleFontSizeInput');
        txt['cms-hero-title-letter-spacing'] = readTitleEditorValue('titleLetterSpacingInput');
        txt['cms-hero-title-shadow'] = readTitleEditorValue('titleShadowInput');
        txt['cms-hero-title-custom-css'] = readTitleEditorValue('titleCustomCssInput');
        txt['cms-hero-tag-1'] = readTitleEditorValue('titleTag1Input') || 'BSIT Student';
        txt['cms-hero-tag-2'] = readTitleEditorValue('titleTag2Input') || 'Gamer';
        txt['cms-hero-tag-3'] = readTitleEditorValue('titleTag3Input') || 'Frontend Learner';
        txt['cms-hero-tag-4'] = readTitleEditorValue('titleTag4Input') || 'Learning Developer';
        txt['cms-hero-stat-1-value'] = readTitleEditorValue('titleProjectsValueInput') || '2';
        txt['cms-hero-stat-1-label'] = readTitleEditorValue('titleProjectsLabelInput') || 'Projects';
        txt['cms-hero-stat-2-value'] = readTitleEditorValue('titleCodingValueInput') || '1+';
        txt['cms-hero-stat-2-label'] = readTitleEditorValue('titleCodingLabelInput') || 'Coding';
        txt['cms-hero-stat-3-value'] = readTitleEditorValue('titleCourseValueInput') || 'BSIT';
        txt['cms-hero-stat-3-label'] = readTitleEditorValue('titleCourseLabelInput') || 'Course';
        txt['cms-hero-stat-4-label'] = readTitleEditorValue('titleUptimeLabelInput') || 'Uptime';
        applyTitleEditorData();
        const res = await saveWithNotification(window.db_saveCMS(window.adminData), "✓ Title Saved");
        if (res) closeTitleEditor();
    };

    window.openUIBuilder = function() {
        sysLog('BUILDER', 'UI Builder initialized');
        document.getElementById('adminSelectionModal').classList.remove('show');
        document.getElementById('uiBuilderToolbar').classList.add('active');
        document.getElementById('uiBuilderToolbar').classList.remove('hidden-by-modal');
        isUIBuilderActive = true; uiLocked = false; selectedElementIndex = -1; updateUILockBtn();
        triggerHaptic('heavy'); SFX.click();
        uiElements = cleanUIElements(uiElements); renderUIElements();
    };

    window.closeUIBuilder = function() {
        sysLog('BUILDER', 'UI Builder closed');
        document.getElementById('uiBuilderToolbar').classList.remove('active', 'hidden-by-modal');
        isUIBuilderActive = false; selectedElementIndex = -1;
        SFX.click(); renderUIElements();
    };

    window.toggleUILock = function() { uiLocked = !uiLocked; updateUILockBtn(); renderUIElements(); SFX.click(); };
    function updateUILockBtn() {
        const btn = document.getElementById('uiLockBtn');
        if (uiLocked) { btn.innerText = "[🔒 LOCKED]"; btn.style.color = "#a1a1aa"; }
        else { btn.innerText = "[🔓 UNLOCKED]"; btn.style.color = "#f59e0b"; }
    }

    window.selectElement = function(index, e) {
        if (!isUIBuilderActive || uiLocked) return;
        e.preventDefault(); e.stopPropagation();
        selectedElementIndex = index;
        renderUIElements(); triggerHaptic('tap'); SFX.hapticTone();
    };

    window.editSelectedElement = function() { if (selectedElementIndex !== -1) editElement(selectedElementIndex); };
    window.duplicateSelectedElement = function() { if (selectedElementIndex !== -1) duplicateElement(selectedElementIndex); };
    window.moveSelectedUp = function() { if (selectedElementIndex !== -1) moveElementUp(selectedElementIndex); };
    window.moveSelectedDown = function() { if (selectedElementIndex !== -1) moveElementDown(selectedElementIndex); };
    window.deleteSelectedElement = function() { if (selectedElementIndex !== -1) deleteElement(selectedElementIndex); };

    window.promptInsertPosition = function() {
        if (uiElements.length === 0) { pendingInsertIndex = -1; hideToolbarForModal(); document.getElementById('elementTypeModal').classList.add('show'); return; }
        if (selectedElementIndex === -1) { showSaveToast('error', 'Please select an element first.'); return; }
        hideToolbarForModal(); document.getElementById('insertPositionModal').classList.add('show'); SFX.click();
    };

    window.setInsertPosition = function(pos) {
        document.getElementById('insertPositionModal').classList.remove('show');
        pendingInsertIndex = (pos === 'above') ? selectedElementIndex - 1 : selectedElementIndex;
        document.getElementById('elementTypeModal').classList.add('show'); SFX.click();
    };

    window.insertNewElement = function(type) {
        document.getElementById('elementTypeModal').classList.remove('show'); showToolbarForModal();
        let newEl = { id: 'el_' + Date.now(), type, content: type.toUpperCase(), title: '', url: '', thumb: '', w: '', h: '', autoplay: false, loop: false, visDesktop: true, visMobile: true, visAdmin: false, style: {} };
        if (type === 'audio') newEl.title = "New Audio Track";
        if (type === 'video') newEl.title = "New Video Stream";
        if (type === 'divider') newEl.content = "";
        if (type === 'button') newEl.content = "New Button";
        if (type === 'card') { newEl.title = "New Card"; newEl.content = "Card content goes here."; }
        if (type === 'notice') { newEl.title = "SYSTEM NOTICE"; newEl.content = "Important transmission."; }
        if (type === 'status') newEl.content = "SYSTEM ONLINE";
        if (type === 'image') newEl.content = "Image Alt Text";
        if (type === 'portfolio-brief') {
            newEl.type = 'text';
            newEl.id = 'el_portfolio_brief_' + Date.now();
            newEl.content = "<section class=\"portfolio-brief\">\n    <div>\n        <div class=\"portfolio-kicker\">Portfolio Overview</div>\n        <h2 class=\"section-title\">About Josh</h2>\n        <p>BSIT student, frontend learner, gamer, and builder of small web tools. This block can be edited, moved, duplicated, or styled from the builder.</p>\n    </div>\n    <div class=\"portfolio-chip-row\">\n        <span>Frontend</span>\n        <span>Game Ideas</span>\n        <span>UI Systems</span>\n        <span>Learning Log</span>\n    </div>\n</section>";
        }
        if (type === 'portfolio-snapshot') {
            newEl.type = 'text';
            newEl.id = 'el_portfolio_snapshot_' + Date.now();
            newEl.content = "<section class=\"portfolio-snapshot\" aria-label=\"Portfolio snapshot\">\n    <div class=\"portfolio-metric\"><span>01</span><strong>Live Site</strong><p>Personal portfolio with intro, sounds, editor, and admin tools.</p></div>\n    <div class=\"portfolio-metric\"><span>02</span><strong>Current Stack</strong><p>HTML, CSS, JavaScript, Firebase, and UI experiments.</p></div>\n    <div class=\"portfolio-metric\"><span>03</span><strong>Direction</strong><p>Cleaner projects, better responsive design, and useful interactive tools.</p></div>\n</section>";
        }
        if (type === 'portfolio-focus') {
            newEl.type = 'text';
            newEl.id = 'el_portfolio_focus_' + Date.now();
            newEl.content = "<section class=\"portfolio-focus\">\n    <div class=\"portfolio-focus-main\">\n        <div class=\"portfolio-kicker\">Now Building</div>\n        <h3>JoshRTX Web Portfolio</h3>\n        <p>A personal website with project cards, editable content, admin controls, intro animation, sounds, and private tools.</p>\n    </div>\n    <div class=\"portfolio-pipeline\">\n        <span><b>Design</b> premium cyber UI</span>\n        <span><b>Code</b> cleaner frontend interactions</span>\n        <span><b>Study</b> BSIT and practical web dev</span>\n        <span><b>Build</b> game and tool ideas</span>\n    </div>\n</section>";
        }
        if (type === 'skill-matrix') {
            newEl.type = 'text';
            newEl.id = 'el_skills_matrix_' + Date.now();
            newEl.content = buildSkillMatrixContent([
                { name: 'HTML/CSS', level: 82 },
                { name: 'JavaScript', level: 68 },
                { name: 'UI Design', level: 74 },
                { name: 'Roblox Studio', level: 62 }
            ]);
        }
        uiElements.splice(pendingInsertIndex + 1, 0, newEl);
        selectedElementIndex = pendingInsertIndex + 1;
        sysLog('BUILDER', `Inserted new ${type.replace(/-/g, ' ')} element`);
        renderUIElements(); triggerHaptic('tap'); SFX.click();
    };

    window.moveElementUp = function(index) {
        if (index <= 0) return;
        [uiElements[index - 1], uiElements[index]] = [uiElements[index], uiElements[index - 1]];
        if (selectedElementIndex === index) selectedElementIndex = index - 1;
        else if (selectedElementIndex === index - 1) selectedElementIndex = index;
        renderUIElements(); triggerHaptic('tap'); SFX.click();
    };

    window.moveElementDown = function(index) {
        if (index >= uiElements.length - 1) return;
        [uiElements[index + 1], uiElements[index]] = [uiElements[index], uiElements[index + 1]];
        if (selectedElementIndex === index) selectedElementIndex = index + 1;
        else if (selectedElementIndex === index + 1) selectedElementIndex = index;
        renderUIElements(); triggerHaptic('tap'); SFX.click();
    };

    window.duplicateElement = function(index) {
        if (uiElements.length >= 50) { sysLog('WARNING', 'Element limit reached.'); return; }
        const copy = JSON.parse(JSON.stringify(uiElements[index]));
        copy.id = 'el_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        uiElements.splice(index + 1, 0, copy);
        sysLog('BUILDER', `Duplicated element`);
        renderUIElements(); triggerHaptic('tap'); SFX.click();
    };

    window.deleteElement = async function(index) {
        const el = uiElements[index];
        if (el.url) await window.db_deleteMediaByUrl(el.url);
        if (el.thumb) await window.db_deleteMediaByUrl(el.thumb);
        uiElements.splice(index, 1);
        if (selectedElementIndex === index) selectedElementIndex = -1;
        else if (selectedElementIndex > index) selectedElementIndex--;
        sysLog('BUILDER', `Deleted element ${el.id}`);
        renderUIElements(); triggerHaptic('heavy'); SFX.error();
    };

    function isSkillMatrixElement(el) {
        return !!(el && el.type === 'text' && (
            el.id === 'el_skills_matrix' ||
            String(el.content || '').includes('portfolio-skill-matrix')
        ));
    }

    function escapeSkillLabel(value) {
        return String(value || '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    function parseSkillMatrixContent(content) {
        const fallback = [
            { name: 'HTML/CSS', level: 82 },
            { name: 'JavaScript', level: 68 },
            { name: 'UI Design', level: 74 },
            { name: 'Roblox Studio', level: 62 }
        ];
        const tracks = [];
        const html = String(content || '');
        const re = /<div\s+class=["']skill-track["']>\s*<span>(.*?)<\/span>\s*<i\s+style=["'][^"']*--level:\s*(\d+)%[^"']*["']><\/i>\s*<\/div>/gis;
        let match;
        while ((match = re.exec(html)) && tracks.length < 4) {
            const name = match[1].replace(/<[^>]+>/g, '').trim();
            const level = Math.max(0, Math.min(100, parseInt(match[2], 10) || 0));
            tracks.push({ name: name || fallback[tracks.length].name, level });
        }
        while (tracks.length < 4) tracks.push(fallback[tracks.length]);
        return tracks;
    }

    function buildSkillMatrixContent(skills) {
        const rows = skills.slice(0, 4).map(skill => {
            const name = escapeSkillLabel(skill.name || 'Skill');
            const level = Math.max(0, Math.min(100, parseInt(skill.level, 10) || 0));
            return `    <div class="skill-track"><span>${name}</span><i style="--level:${level}%"></i></div>`;
        }).join('\n');
        return `<section class="portfolio-skill-matrix">\n${rows}\n</section>`;
    }

    function populateSkillLevelEditor(el) {
        parseSkillMatrixContent(el.content).forEach((skill, i) => {
            const n = i + 1;
            const nameInput = document.getElementById(`skillName${n}Input`);
            const levelInput = document.getElementById(`skillLevel${n}Input`);
            if (nameInput) nameInput.value = skill.name;
            if (levelInput) levelInput.value = skill.level;
        });
        syncSkillLevelEditor();
    }

    function readSkillLevelEditor() {
        return [1, 2, 3, 4].map(n => {
            const nameInput = document.getElementById(`skillName${n}Input`);
            const levelInput = document.getElementById(`skillLevel${n}Input`);
            return {
                name: nameInput ? nameInput.value.trim() : '',
                level: levelInput ? levelInput.value : 0
            };
        });
    }

    window.syncSkillLevelEditor = function() {
        [1, 2, 3, 4].forEach(n => {
            const levelInput = document.getElementById(`skillLevel${n}Input`);
            const valueLabel = document.getElementById(`skillLevel${n}Value`);
            if (levelInput && valueLabel) valueLabel.innerText = `${levelInput.value}%`;
        });
    };

    window.editElement = function(index) {
        editingIndex = index;
        const el = uiElements[index];
        document.getElementById('edType').innerText = el.type.toUpperCase();
        document.getElementById('edTitle').value = el.title || '';
        document.getElementById('edContent').value = el.content || '';
        document.getElementById('edUrl').value = el.url || '';
        document.getElementById('edThumb').value = el.thumb || '';
        document.getElementById('edW').value = el.w || '';
        document.getElementById('edH').value = el.h || '';
        document.getElementById('edAutoplay').checked = el.autoplay || false;
        document.getElementById('edLoop').checked = el.loop || false;
        document.getElementById('edVisDesktop').checked = el.visDesktop !== false;
        document.getElementById('edVisMobile').checked = el.visMobile !== false;
        document.getElementById('edVisAdmin').checked = el.visAdmin || false;
        writeElementStyle(el.style || {});
        const fields = ['rowTitle', 'rowContent', 'rowUrl', 'rowThumb', 'rowDim', 'rowMediaToggles', 'rowPopupData', 'rowFileUpload', 'rowSkillLevels'];
        fields.forEach(f => document.getElementById(f).style.display = 'none');
        const contentLabel = document.getElementById('lblContent');
        contentLabel.innerText = "Content / Label / HTML";
        if (['card', 'notice', 'audio', 'video', 'popup-card'].includes(el.type)) document.getElementById('rowTitle').style.display = 'block';
        if (['text', 'card', 'button', 'notice', 'status', 'image', 'popup-card'].includes(el.type)) { document.getElementById('rowContent').style.display = 'block'; if (el.type === 'image') contentLabel.innerText = "Alt Text"; }
        if (isSkillMatrixElement(el)) {
            document.getElementById('rowSkillLevels').style.display = 'block';
            contentLabel.innerText = "Skill matrix HTML";
            populateSkillLevelEditor(el);
        }
        if (isSkillMatrixElement(el)) {
            document.getElementById('rowSkillLevels').style.display = 'block';
            contentLabel.innerText = "Skill matrix HTML";
            populateSkillLevelEditor(el);
        }
        if (['image', 'audio', 'video', 'button'].includes(el.type)) document.getElementById('rowUrl').style.display = 'block';
        if (['image', 'audio', 'video'].includes(el.type)) {
            document.getElementById('rowFileUpload').style.display = 'block';
            const fileInput = document.getElementById('edFile');
            if (el.type === 'image') fileInput.accept = "image/jpeg,image/png,image/webp,image/gif";
            else if (el.type === 'audio') fileInput.accept = "audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/m4a";
            else if (el.type === 'video') fileInput.accept = "video/mp4,video/webm,video/ogg";
        }
        if (['audio', 'video'].includes(el.type)) document.getElementById('rowThumb').style.display = 'block';
        if (['image', 'video'].includes(el.type)) document.getElementById('rowDim').style.display = 'block';
        if (['audio', 'video'].includes(el.type)) document.getElementById('rowMediaToggles').style.display = 'block';
        if (el.type === 'popup-card' && el.target) {
            document.getElementById('rowPopupData').style.display = 'block';
            document.getElementById('edPopupTitle').value = window.adminData.textEditor[`cms-modal-${el.target}-title`] || '';
            document.getElementById('edPopupContent').value = window.adminData.textEditor[`cms-modal-${el.target}-content`] || '';
        }
        hideToolbarForModal();
        document.getElementById('elementEditorModal').classList.add('show');
        SFX.modalOpen();
    };

    window.saveElementEdit = function() {
        if (editingIndex === -1) return;
        const el = uiElements[editingIndex];
        const oldUrl = el.url, oldThumb = el.thumb;
        el.title = document.getElementById('edTitle').value;
        el.content = isSkillMatrixElement(el) ? buildSkillMatrixContent(readSkillLevelEditor()) : document.getElementById('edContent').value;
        el.url = document.getElementById('edUrl').value;
        el.thumb = document.getElementById('edThumb').value;
        el.w = document.getElementById('edW').value;
        el.h = document.getElementById('edH').value;
        el.autoplay = document.getElementById('edAutoplay').checked;
        el.loop = document.getElementById('edLoop').checked;
        el.visDesktop = document.getElementById('edVisDesktop').checked;
        el.visMobile = document.getElementById('edVisMobile').checked;
        el.visAdmin = document.getElementById('edVisAdmin').checked;
        el.style = readElementStyle();
        if (el.type === 'popup-card' && el.target) {
            window.adminData.textEditor[`cms-modal-${el.target}-title`] = document.getElementById('edPopupTitle').value;
            window.adminData.textEditor[`cms-modal-${el.target}-content`] = document.getElementById('edPopupContent').value;
        }
        if (oldUrl !== el.url && oldUrl) window.db_deleteMediaByUrl(oldUrl);
        if (oldThumb !== el.thumb && oldThumb) window.db_deleteMediaByUrl(oldThumb);
        document.getElementById('elementEditorModal').classList.remove('show');
        showToolbarForModal(); sysLog('BUILDER', `Applied edits to ${el.id}`);
        SFX.success(); renderUIElements(); saveUIBuilder();
    };

    window.promptUIReset = function() { hideToolbarForModal(); document.getElementById('resetConfirmModal').classList.add('show'); SFX.click(); };
    window.closeResetModal = function() { document.getElementById('resetConfirmModal').classList.remove('show'); showToolbarForModal(); SFX.click(); };

    window.executeUIReset = function() {
        undoSnapshot = JSON.parse(JSON.stringify(uiElements));
        document.getElementById('btnUndoReset').style.display = 'inline-block';
        uiElements = window.getDefaultUIElements(); selectedElementIndex = -1;
        closeResetModal(); sysLog('BUILDER', 'Layout restored to defaults');
        renderUIElements(); triggerHaptic('heavy'); SFX.notif();
        showSaveToast("success", "✓ Default Layout Restored. (Unsaved)");
    };

    window.undoUIReset = function() {
        if (undoSnapshot) {
            uiElements = JSON.parse(JSON.stringify(undoSnapshot)); undoSnapshot = null;
            document.getElementById('btnUndoReset').style.display = 'none';
            sysLog('BUILDER', 'Layout reset undone'); renderUIElements();
            triggerHaptic('success'); SFX.success(); showSaveToast("success", "↶ Reset Undone");
        }
    };

    window.saveUIBuilder = async function() {
        uiElements = cleanUIElements(uiElements);
        window.adminData.uiBuilder = uiElements;
        const res = await saveWithNotification(window.db_saveCMS(window.adminData), "✓ System Layout Saved");
        if (res) { undoSnapshot = null; document.getElementById('btnUndoReset').style.display = 'none'; renderUIElements(); }
    };

    window.renderUIElements = function() {
        const container = document.getElementById('custom-ui-grid');
        if (!container) return;
        container.innerHTML = "";
        const isAdmin = sessionStorage.getItem('admin_auth') === 'true';
        const selDisp = document.getElementById('selectedElDisplay');
        const dynControls = document.getElementById('dynamicControls');
        if (selDisp && dynControls) {
            if (selectedElementIndex === -1 || !isUIBuilderActive) { selDisp.innerText = "Selected: None"; dynControls.style.display = "none"; }
            else {
                const s = uiElements[selectedElementIndex];
                if (!s) {
                    selectedElementIndex = -1;
                    selDisp.innerText = "Selected: None";
                    dynControls.style.display = "none";
                } else {
                    const name = s.title || (s.content ? s.content.replace(/<[^>]+>/g, '').substring(0, 15) : '') || s.type;
                    selDisp.innerText = `Selected: ${name}`; dynControls.style.display = "flex";
                }
            }
        }
        let inGrid = false, gridDom = null;
        uiElements.forEach((data, index) => {
            if (!isUIBuilderActive) {
                if (data.visDesktop === false && window.innerWidth > 768) return;
                if (data.visMobile === false && window.innerWidth <= 768) return;
                if (data.visAdmin && !isAdmin) return;
            }
            const isGridItem = (data.type === 'popup-card');
            if (isGridItem && !inGrid) { gridDom = document.createElement('div'); gridDom.className = 'grid layout-section'; container.appendChild(gridDom); inGrid = true; }
            else if (!isGridItem && inGrid) { inGrid = false; gridDom = null; }

            const dom = document.createElement('div');
            const classes = ['builder-el'];
            if (!isUIBuilderActive) classes.push('reveal'); else classes.push('active');
            if (isUIBuilderActive && !uiLocked) classes.push('edit-mode');
            if (uiLocked) classes.push('locked');
            if (isUIBuilderActive && index === selectedElementIndex) classes.push('selected');
            dom.className = classes.join(' ');
            dom.id = data.id;
            if (isUIBuilderActive && !uiLocked) dom.onclick = (e) => selectElement(index, e);

            let innerHTML = '';
            switch (data.type) {
                case 'text': innerHTML = `<div class="builder-style-surface">${data.content}</div>`; break;
                case 'card': innerHTML = `<div class="card about-card builder-style-surface" style="width:100%;"><h3 style="color:var(--c-acc);">${data.title || 'Card Title'}</h3><p style="white-space:pre-wrap;">${data.content || 'Card Content'}</p></div>`; break;
                case 'popup-card': innerHTML = `<div class="card hover-target builder-style-surface" onclick="if(!${isUIBuilderActive}) { openModal('${data.target}'); SFX.click(); }"><h3 style="color:#fff;">${data.title}</h3><p style="white-space:pre-wrap;">${data.content}</p></div>`; break;
                case 'button': {
                    const btnClass = data.isDisconnect ? "btn hover-target disconnect-btn" : "btn hover-target";
                    const clickHandler = data.isDisconnect ? `${data.url || ''}; SFX.click();` : `SFX.click(); ${data.url ? `window.location.href='${data.url}'` : ''}`;
                    innerHTML = `<button class="${btnClass} builder-style-surface" onclick="${clickHandler}">${data.content}</button>`; break;
                }
                case 'notice': innerHTML = `<div class="b-notice builder-style-surface"><strong style="color:var(--c-prim);">${data.title || ''}</strong> <span style="color:#d1fae5;white-space:pre-wrap;">${data.content || ''}</span></div>`; break;
                case 'image': innerHTML = `<img class="b-image builder-style-surface" src="${data.url || ''}" alt="${data.content || ''}" style="width:${data.w || '100%'};height:${data.h || 'auto'};" loading="lazy">`; break;
                case 'audio': innerHTML = `<div class="b-audio"><div class="builder-style-surface" style="padding:15px;background:var(--card-bg);border-radius:8px;border:1px solid var(--c-prim);"><p style="color:var(--c-acc);margin-bottom:10px;font-weight:bold;">${data.title || 'Audio Track'}</p><audio controls ${data.autoplay ? 'autoplay' : ''} ${data.loop ? 'loop' : ''} style="width:100%;">${data.url ? `<source src="${data.url}">` : ''}</audio></div></div>`; break;
                case 'video': innerHTML = `<div class="b-video"><video class="builder-style-surface" controls ${data.autoplay ? 'autoplay muted' : ''} ${data.loop ? 'loop' : ''} poster="${data.thumb || ''}" style="width:${data.w || '100%'};height:${data.h || 'auto'};border-radius:8px;border:1px solid var(--c-prim);">${data.url ? `<source src="${data.url}">` : ''}</video></div>`; break;
                case 'divider': innerHTML = `<div class="b-divider builder-style-surface"></div>`; break;
                case 'status': innerHTML = `<div class="b-status builder-style-surface"><span class="status-icon"></span>${data.content || 'SYSTEM ONLINE'}</div>`; break;
                case 'quick': innerHTML = `<div class="b-quick-access builder-style-surface">${(data.content || '').split(',').map(item => item.trim()).filter(Boolean).map(item => `<button class="btn hover-target" style="margin-top:0;padding:10px 15px;font-size:0.9rem;" onclick="SFX.click();">${item}</button>`).join('')}</div>`; break;
                default: innerHTML = `<p style="color:#a1a1aa;font-family:monospace;">[${data.type}]</p>`; break;
            }
            dom.innerHTML = innerHTML;
            applyBuilderStyles(data, dom);
            if (isGridItem && gridDom) gridDom.appendChild(dom);
            else container.appendChild(dom);

            // Watch this element for reveal animations.
            if (!isUIBuilderActive && window.scrollObserver) window.scrollObserver.observe(dom);
        });
    };

    // ======================================================
    // CHANGELOG EDITOR
    // ======================================================
    window.openChangelogEditor = function() {
        document.getElementById('adminSelectionModal').classList.remove('show');
        hideToolbarForModal();
        const sel = document.getElementById('clSelectVersion');
        sel.innerHTML = '<option value="new">-- Create New Version --</option>';
        if (window.adminData.changelogs) {
            window.adminData.changelogs.forEach((cl, i) => { sel.innerHTML += `<option value="${i}">${cl.version}</option>`; });
        }
        document.getElementById('changelogEditorModal').classList.add('show');
        SFX.modalOpen();
        sysLog('BUILDER', 'Changelog editor opened');
    };
    window.closeChangelogEditor = function() { document.getElementById('changelogEditorModal').classList.remove('show'); showToolbarForModal(); SFX.modalClose(); };
    window.switchChangelogMode = function() {
        const sel = document.getElementById('clSelectVersion').value;
        if (sel === 'new') { document.getElementById('clVersion').value = ''; document.getElementById('clAdded').value = ''; }
        else {
            const cl = window.adminData.changelogs[parseInt(sel)];
            if (cl) { document.getElementById('clVersion').value = cl.version || ''; document.getElementById('clAdded').value = cl.added || ''; }
        }
    };
    window.pushChangelog = async function() {
        const version = document.getElementById('clVersion').value.trim();
        const added = document.getElementById('clAdded').value.trim();
        if (!version) return;
        if (!window.adminData.changelogs) window.adminData.changelogs = [];
        const selVal = document.getElementById('clSelectVersion').value;
        if (selVal === 'new') window.adminData.changelogs.unshift({ version, added, date: new Date().toISOString().split('T')[0] });
        else { const idx = parseInt(selVal); window.adminData.changelogs[idx] = { version, added, date: window.adminData.changelogs[idx]?.date || new Date().toISOString().split('T')[0] }; }
        const res = await saveWithNotification(window.db_saveCMS(window.adminData), "✓ Changelog Saved");
        if (res) {
            SFX.success();
            renderChangelogFeed(window.adminData.changelogs);
            closeChangelogEditor();
        }
    };

    function renderChangelogFeed(changelogs) {
        const feed = document.getElementById('changelogFeed');
        if (!feed) return;
        if (!changelogs || changelogs.length === 0) { feed.innerHTML = '<p>No updates yet.</p>'; return; }
        feed.innerHTML = changelogs.slice(0, 5).map((cl, i) => `<p><span class="v-tag">${cl.version}</span>${i === 0 ? '<span class="new-tag">NEW</span>' : ''} — ${cl.added}</p>`).join('');
    }

    async function loadLoginChangelogs() {
        const feed = document.getElementById('changelogFeed');
        if (!feed) return;
        if (!window.db_loadCMS) { setTimeout(loadLoginChangelogs, 400); return; }
        try {
            const cmsData = await window.db_loadCMS('main_portfolio');
            if (cmsData && Array.isArray(cmsData.changelogs) && cmsData.changelogs.length > 0) {
                if (cmsData.changelogs) window.adminData.changelogs = cmsData.changelogs;
                renderChangelogFeed(cmsData.changelogs);
            } else {
                feed.innerHTML = '<p style="color:#52525b;">No patch notes yet.</p>';
            }
        } catch(e) {
            feed.innerHTML = '<p style="color:#52525b;">Could not load patch notes.</p>';
        }
    }

        // Uptime counter — counts from site deployment date.
    // To reset uptime after an update: bump SITE_VERSION below.
    const SITE_VERSION    = '4.2.1';
    const SITE_LAUNCH_DATE = '2026-05-25T17:29:00';
    const _siteEpochFallback = new Date(SITE_LAUNCH_DATE).getTime();
    if (localStorage.getItem('jr_site_version') !== SITE_VERSION) {
        localStorage.setItem('jr_site_version', SITE_VERSION);
        localStorage.setItem('jr_site_epoch', String(_siteEpochFallback));
    }
    const _siteEpoch = parseInt(localStorage.getItem('jr_site_epoch')) || _siteEpochFallback;
    function tickHeroUptime() {
        const el = document.getElementById('heroUptime');
        if (!el) return;
        const diff = Math.floor((Date.now() - _siteEpoch) / 1000);
        const days = Math.floor(diff / 86400);
        const hrs  = Math.floor((diff % 86400) / 3600);
        const mins = Math.floor((diff % 3600) / 60);
        const secs = diff % 60;
        if (days > 0)      el.textContent = days + 'd ' + hrs + 'h';
        else if (hrs > 0)  el.textContent = hrs + 'h ' + mins + 'm';
        else if (mins > 0) el.textContent = mins + 'm ' + secs + 's';
        else               el.textContent = secs + 's';
    }
    setInterval(tickHeroUptime, 1000);

    // ======================================================
    // SYS MANAGER
    // ======================================================
    const eggConfigKeys = [
        ['eggVirus', 'eggVirusValue', 'virus', 3],
        ['eggGlitch', 'eggGlitchValue', 'glitch', 5],
        ['eggVoid', 'eggVoidValue', 'void', 1],
        ['eggMeltdown', 'eggMeltdownValue', 'meltdown', 2]
    ];

    function readEggControl(id, fallback = 0) {
        const input = document.getElementById(id);
        const raw = Number.parseInt(input?.value ?? fallback, 10);
        return Math.max(0, Math.min(20, Number.isFinite(raw) ? raw : fallback));
    }

    window.syncEggConfigUI = function() {
        eggConfigKeys.forEach(([inputId, labelId]) => {
            const input = document.getElementById(inputId);
            const label = document.getElementById(labelId);
            if (!input || !label) return;
            const value = readEggControl(inputId, 0);
            input.value = String(value);
            label.innerText = value + '%';
        });
    };

    window.openSysManager = function() {
        document.getElementById('adminSelectionModal').classList.remove('show');
        hideToolbarForModal();
        const eggs = sysConfig.eggs || {};
        eggConfigKeys.forEach(([inputId, , key, fallback]) => {
            const input = document.getElementById(inputId);
            if (input) input.value = String(eggs[key] ?? fallback);
        });
        document.getElementById('sysManagerModal').classList.add('show');
        syncEggConfigUI();
        SFX.modalOpen();
    };
    window.closeSysManager = function() { document.getElementById('sysManagerModal').classList.remove('show'); showToolbarForModal(); SFX.modalClose(); };
    window.saveSysConfig = async function() {
        if (!sysConfig.eggs) sysConfig.eggs = {};
        eggConfigKeys.forEach(([inputId, , key]) => {
            sysConfig.eggs[key] = readEggControl(inputId, 0);
        });
        window.adminData.sysConfig = sysConfig;
        const res = await saveWithNotification(window.db_saveCMS(window.adminData), "✓ Effect Settings Saved");
        if (res) { SFX.success(); closeSysManager(); triggerHaptic('success'); }
    };

    // ======================================================
    // WINDOW CLICK HANDLER (FIXED — no duplicate conditions)
    // ======================================================
    window.addEventListener('click', function(e) {
        const modals = [
            { id: 'modal', fn: () => closeModal() },
            { id: 'feedbackModal', fn: () => closeFeedbackModal() },
            { id: 'adminModal', fn: () => document.getElementById('adminModal').classList.remove('show') },
            { id: 'adminSelectionModal', fn: () => { document.getElementById('adminSelectionModal').classList.remove('show'); showToolbarForModal(); } },
            { id: 'systemLogsModal', fn: () => closeSystemLogs() },
            { id: 'changelogEditorModal', fn: () => closeChangelogEditor() },
            { id: 'sysManagerModal', fn: () => closeSysManager() },
            { id: 'titleEditorModal', fn: () => closeTitleEditor() },
            { id: 'insertPositionModal', fn: () => { document.getElementById('insertPositionModal').classList.remove('show'); showToolbarForModal(); } },
            { id: 'elementTypeModal', fn: () => { document.getElementById('elementTypeModal').classList.remove('show'); showToolbarForModal(); } },
            { id: 'elementEditorModal', fn: () => { document.getElementById('elementEditorModal').classList.remove('show'); showToolbarForModal(); } },
            { id: 'resetConfirmModal', fn: () => closeResetModal() }
        ];
        modals.forEach(m => {
            const el = document.getElementById(m.id);
            if (el && e.target === el) { SFX.modalClose(); m.fn(); }
        });
        // Close settings panels when clicking outside
        if (!e.target.closest('.settings-panel') && !e.target.closest('.sys-settings-btn') && !e.target.closest('.compact-status')) {
            document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('show'));
        }
    });

    // ======================================================
    // CURSOR & BACKGROUND PARALLAX
    // ======================================================
    const cursorDot = document.getElementById("customCursor");
    const cursorRing = document.getElementById("cursorRing");
    let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;
    let ringX = mouseX, ringY = mouseY;

    if (window.matchMedia("(pointer: fine)").matches && cursorDot && cursorRing) {
        let ringFrame = 0;
        let cursorVisible = false;
        const root = document.documentElement;

        function setCursorPosition(el, x, y) {
            el.style.setProperty('--cursor-x', x.toFixed(2) + 'px');
            el.style.setProperty('--cursor-y', y.toFixed(2) + 'px');
        }

        function hideCursor() {
            cursorVisible = false;
            root.classList.remove('custom-cursor-ready');
            cursorDot.classList.remove('hover', 'clicking');
            cursorRing.classList.remove('hover', 'clicking');
        }

        function scheduleRingFrame() {
            if (!ringFrame && !document.hidden) ringFrame = requestAnimationFrame(animateRing);
        }

        function animateRing() {
            ringFrame = 0;
            const dx = mouseX - ringX;
            const dy = mouseY - ringY;
            const ease = isLowEndMotionDevice() ? 0.2 : 0.15;
            ringX += dx * ease;
            ringY += dy * ease;
            setCursorPosition(cursorRing, ringX, ringY);
            if (Math.abs(dx) > 0.08 || Math.abs(dy) > 0.08) scheduleRingFrame();
        }

        document.addEventListener("pointermove", (e) => {
            const dx = e.clientX - mouseX;
            const dy = e.clientY - mouseY;
            mouseX = e.clientX;
            mouseY = e.clientY;
            setCursorPosition(cursorDot, mouseX, mouseY);
            if (!cursorVisible) {
                cursorVisible = true;
                ringX = mouseX;
                ringY = mouseY;
                setCursorPosition(cursorRing, ringX, ringY);
            }
            if (Math.abs(dx) + Math.abs(dy) > 0.2) {
                const angle = Math.atan2(dy, dx) * 180 / Math.PI + 'deg';
                cursorDot.style.setProperty('--cursor-angle', angle);
                cursorRing.style.setProperty('--cursor-angle', angle);
            }
            root.classList.add('custom-cursor-ready');
            scheduleRingFrame();
        }, { passive: true });

        document.addEventListener('pointerdown', () => {
            cursorDot.classList.add('clicking');
            cursorRing.classList.add('clicking');
        });
        document.addEventListener('pointerup', () => {
            cursorDot.classList.remove('clicking');
            cursorRing.classList.remove('clicking');
        });

        document.addEventListener('pointerover', e => {
            const target = e.target.closest?.('.hover-target');
            if (!target || (e.relatedTarget && target.contains(e.relatedTarget))) return;
            cursorDot.classList.add('hover');
            cursorRing.classList.add('hover');
            SFX.hover();
        });
        document.addEventListener('pointerout', e => {
            const target = e.target.closest?.('.hover-target');
            if (!target || (e.relatedTarget && target.contains(e.relatedTarget))) return;
            cursorDot.classList.remove('hover');
            cursorRing.classList.remove('hover');
        });

        document.documentElement.addEventListener('pointerleave', hideCursor);
        window.addEventListener('blur', hideCursor);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (ringFrame) cancelAnimationFrame(ringFrame);
                ringFrame = 0;
                hideCursor();
            }
        });
        // Card tilt is handled by the immersive engine below to avoid double transform writes.
    }

    // ======================================================
    // CANVAS PARTICLE SYSTEM — theme-aware, delta-time, high-Hz
    // ======================================================
    (function() {
        const cv = document.getElementById('particleCanvas');
        if (!cv) return;
        const profile = getMotionProfile();
        const isMobile = profile.mobile;
        const lowEnd = profile.lowEnd;
        if (profile.reduced) {
            cv.hidden = true;
            cv.style.display = 'none';
            return;
        }
        cv.hidden = false;
        cv.style.display = 'block';
        const ctx = cv.getContext('2d', { alpha: true, desynchronized: true });
        if (!ctx) return;
        const bootLayer = document.getElementById('boot-canvas');
        const loadingLayers = Array.from(document.querySelectorAll('.loading-screen'));

        let W = 0, H = 0, paused = document.hidden, lastTs = 0, resizeTimer = null;
        let frameRequest = 0, wakeTimer = 0;
        let particles = [];
        let adaptive = Boolean(window.getAdaptiveMotionState?.().active);

        function particleLimit() {
            if (!adaptive) return lowEnd ? 4 : (isMobile ? 6 : 18);
            return lowEnd ? 3 : (isMobile ? 4 : 10);
        }

        function frameInterval() {
            if (!adaptive) return lowEnd ? 100 : (isMobile ? 50 : 33);
            return lowEnd ? 125 : (isMobile ? 80 : 50);
        }

        function coveredByTransition() {
            return Boolean(bootLayer?.isConnected) || loadingLayers.some(layer => layer.classList.contains('active'));
        }

        function stopScheduler() {
            if (frameRequest) cancelAnimationFrame(frameRequest);
            if (wakeTimer) clearTimeout(wakeTimer);
            frameRequest = 0;
            wakeTimer = 0;
        }

        function scheduleDraw(delay = 0) {
            if (paused || frameRequest || wakeTimer) return;
            if (delay > 0) {
                wakeTimer = setTimeout(() => {
                    wakeTimer = 0;
                    if (!paused) frameRequest = requestAnimationFrame(draw);
                }, delay);
                return;
            }
            frameRequest = requestAnimationFrame(draw);
        }

        // ── Resize: match physical pixels for crisp rendering ──
        function resize() {
            const p = cv.parentElement;
            W = (p && p.offsetWidth  > 0) ? p.offsetWidth  : window.innerWidth;
            H = (p && p.offsetHeight > 0) ? p.offsetHeight : window.innerHeight;
            const dpr = adaptive
                ? maxLongSideDpr(W, H, (isMobile || lowEnd) ? 1080 : 1920, lowEnd ? 1.35 : (isMobile ? 1.5 : 1.75))
                : (lowEnd
                    ? maxLongSideDpr(W, H, 1080, 1.6)
                    : fullHdCappedDpr(W, H, isMobile ? 1.7 : 2));
            cv.width  = Math.round(W * dpr);
            cv.height = Math.round(H * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        resize();
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(resize, isMobile ? 180 : 80);
        }, { passive: true });
        document.addEventListener('visibilitychange', () => {
            paused = document.hidden;
            lastTs = 0;
            if (paused) stopScheduler();
            else scheduleDraw();
        });

        // ── Read CSS vars ──
        function cssVar(name) {
            return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        }
        function toRgba(raw, a) {
            if (!raw) return `rgba(6,182,212,${a})`;
            if (raw.startsWith('rgb')) {
                const m = raw.match(/[\d.]+/g);
                return m ? `rgba(${m[0]},${m[1]},${m[2]},${a})` : `rgba(6,182,212,${a})`;
            }
            const hex = raw.replace('#','');
            const full = hex.length === 3 ? hex.split('').map(c=>c+c).join('') : hex;
            const r = parseInt(full.substr(0,2),16);
            const g = parseInt(full.substr(2,2),16);
            const b = parseInt(full.substr(4,2),16);
            return `rgba(${r},${g},${b},${a})`;
        }
        function getColors() {
            return [cssVar('--c-prim'), cssVar('--c-sec'), cssVar('--c-acc')];
        }
        let palette = getColors();
        const glowSprites = new Map();

        function getGlowSprite(color) {
            if (glowSprites.has(color)) return glowSprites.get(color);

            const size = 48;
            const center = size / 2;
            const sprite = document.createElement('canvas');
            sprite.width = size;
            sprite.height = size;
            const spriteCtx = sprite.getContext('2d', { alpha: true });
            if (!spriteCtx) return null;

            const glow = spriteCtx.createRadialGradient(center, center, 0, center, center, center);
            glow.addColorStop(0, toRgba(color, lowEnd ? 0.45 : 0.85));
            glow.addColorStop(0.4, toRgba(color, lowEnd ? 0.14 : 0.28));
            glow.addColorStop(1, toRgba(color, 0));
            spriteCtx.fillStyle = glow;
            spriteCtx.fillRect(0, 0, size, size);
            glowSprites.set(color, sprite);
            return sprite;
        }

        // ── Spawn ──
        function spawn(spreadY) {
            const color = palette[Math.floor(Math.random() * palette.length)];
            const maxLife = 9000 + Math.random() * 10000;
            return {
                x:    Math.random() * W,
                y:    spreadY !== undefined ? Math.random() * H : H + 20,
                r:    0.65 + Math.random() * 1.55,
                vx:   (Math.random() - 0.5) * 0.25,
                vy:   -(0.25 + Math.random() * 0.65),
                life: spreadY !== undefined ? Math.random() * maxLife : 0,
                maxLife,
                color,
                phase: Math.random() * Math.PI * 2,
                speed: 1.2 + Math.random() * 1.8,
            };
        }

        // ── Seed initial spread ──
        for (let i = 0; i < particleLimit(); i++) particles.push(spawn(true));

        // ── Draw loop ──
        function draw(ts) {
            frameRequest = 0;
            if (paused) return;
            if (coveredByTransition() || document.body.classList.contains('perf-mode')) {
                lastTs = ts;
                scheduleDraw(Math.max(frameInterval(), 240));
                return;
            }
            const dt = Math.min(ts - (lastTs || ts), 50); // cap at 50ms
            lastTs = ts;

            ctx.clearRect(0, 0, W, H);

            // Refill
            while (particles.length < particleLimit()) particles.push(spawn());

            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.life += dt;
                p.phase += p.speed * dt * 0.001;
                // Gentle sine drift
                p.x += (p.vx + Math.sin(p.phase * 0.4) * (lowEnd ? 0.035 : 0.12)) * dt * (lowEnd ? 0.025 : 0.06);
                p.y += p.vy * dt * (lowEnd ? 0.025 : 0.06);

                const lifeRatio = p.life / p.maxLife;
                let alpha;
                if      (lifeRatio < 0.12) alpha = lifeRatio / 0.12;
                else if (lifeRatio > 0.80) alpha = (1 - lifeRatio) / 0.20;
                else                       alpha = 1;
                // Twinkle
                alpha *= 0.55 + 0.45 * Math.sin(p.phase * 2);

                if (p.life >= p.maxLife || p.y < -30) {
                    particles[i] = spawn(); continue;
                }

                const glowR = p.r * (lowEnd ? 2.2 : (isMobile ? 3.4 : 5));
                const glowSprite = getGlowSprite(p.color);
                if (glowSprite) {
                    ctx.globalAlpha = alpha;
                    ctx.drawImage(glowSprite, p.x - glowR, p.y - glowR, glowR * 2, glowR * 2);
                    ctx.globalAlpha = 1;
                }

                // Core dot
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r * (0.7 + 0.3 * Math.sin(p.phase * 2)), 0, Math.PI * 2);
                ctx.fillStyle = toRgba(p.color, Math.min(alpha * 1.2, 1));
                ctx.fill();
            }
            scheduleDraw(frameInterval());
        }

        scheduleDraw();

        window.addEventListener('adaptiveperformancechange', event => {
            const nextAdaptive = Boolean(event.detail?.active);
            if (adaptive === nextAdaptive) return;
            adaptive = nextAdaptive;
            particles.length = Math.min(particles.length, particleLimit());
            lastTs = 0;
            resize();
            stopScheduler();
            scheduleDraw();
        });

        // Refresh colors on theme change (mutation on :root vars via body class)
        new MutationObserver(() => {
            const nextPalette = getColors();
            if (nextPalette.join('|') === palette.join('|')) return;
            palette = nextPalette;
            glowSprites.clear();
            particles.forEach(p => {
                p.color = palette[Math.floor(Math.random() * palette.length)];
            });
        }).observe(document.body, { attributeFilter: ['class'] });
    })();


    // ======================================================
    // SCROLL REVEAL OBSERVER
    // ======================================================
    window.scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            entry.target.classList.toggle('motion-offscreen', !entry.isIntersecting);
            if (entry.isIntersecting) entry.target.classList.add('active');
        });
    }, { threshold: 0.01, rootMargin: '180px 0px' });

    document.querySelectorAll('.hero, .ticker-wrap, .update-logs').forEach(el => {
        window.scrollObserver.observe(el);
    });

    // ======================================================

    // ═══════════════════════════════════════════════════
    //  IMMERSIVE 3D EFFECTS ENGINE
    // ═══════════════════════════════════════════════════
    (function() {
        const isTouch = window.matchMedia('(pointer:coarse)').matches;
        const pointerWrites = new WeakMap();

        function queuePointerWrite(el, e, write) {
            let state = pointerWrites.get(el);
            if (!state) {
                state = { x: 0, y: 0, frame: 0, write };
                pointerWrites.set(el, state);
            }
            state.x = e.clientX;
            state.y = e.clientY;
            state.write = write;
            if (state.frame) return;
            state.frame = requestAnimationFrame(function() {
                state.frame = 0;
                state.write(state.x, state.y);
            });
        }

        function clearPointerWrite(el, reset) {
            const state = pointerWrites.get(el);
            if (state?.frame) cancelAnimationFrame(state.frame);
            pointerWrites.delete(el);
            reset();
        }

        // ── 1. CARD MOUSE-TRACKING 3D TILT ────────────────
        function applyTilt(el, clientX, clientY, maxRot, tz) {
            const r = el.getBoundingClientRect();
            const dx = (clientX - (r.left + r.width  / 2)) / (r.width  / 2);
            const dy = (clientY - (r.top  + r.height / 2)) / (r.height / 2);
            el.style.transform =
                `perspective(900px) rotateX(${(-dy * maxRot).toFixed(2)}deg) rotateY(${(dx * maxRot).toFixed(2)}deg) translateZ(${tz}px)`;
        }
        function resetTilt(el) { el.style.transform = ''; }

        function attachCardTilt() {
            document.querySelectorAll('.card:not([data-tilt])').forEach(function(c) {
                c.dataset.tilt = '1';
                if (isTouch) return;
                const writeTilt = function(x, y) { applyTilt(c, x, y, 9, 10); };
                c.addEventListener('mousemove', function(e) {
                    if (document.body.classList.contains('perf-mode')) return;
                    queuePointerWrite(c, e, writeTilt);
                });
                c.addEventListener('mouseleave', function() {
                    clearPointerWrite(c, function() { resetTilt(c); });
                });
            });
        }
        attachCardTilt();

        // ── 2. AVATAR 3D TILT ─────────────────────────────
        if (!isTouch) {
            var av = document.querySelector('.hero-avatar');
            if (av) {
                var writeAvatarTilt = function(x, y) { applyTilt(av, x, y, 18, 12); };
                av.addEventListener('mousemove', function(e) {
                    queuePointerWrite(av, e, writeAvatarTilt);
                });
                av.addEventListener('mouseleave', function() {
                    clearPointerWrite(av, function() { resetTilt(av); });
                });
            }
        }

        // ── 3. MAGNETIC BUTTON ────────────────────────────
        if (!isTouch) {
            function applyMag(btn, clientX, clientY) {
                var r = btn.getBoundingClientRect();
                var dx = (clientX - (r.left + r.width  / 2)) * 0.14;
                var dy = (clientY - (r.top  + r.height / 2)) * 0.14;
                btn.style.transform =
                    `translateY(-6px) scale(1.03) translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
            }
            document.querySelectorAll('.btn').forEach(function(btn) {
                var writeMag = function(x, y) { applyMag(btn, x, y); };
                btn.addEventListener('mousemove', function(e) { queuePointerWrite(btn, e, writeMag); });
                btn.addEventListener('mouseleave', function() {
                    clearPointerWrite(btn, function() { btn.style.transform = ''; });
                });
            });
        }

        // ── 4. BACKGROUND PARALLAX ────────────────────────
        if (!isTouch) {
            var bgEl = document.querySelector('.bg');
            if (bgEl) {
                var rafPx = null;
                var tX = 0, tY = 0;
                document.addEventListener('mousemove', function(e) {
                    tX = (e.clientX / window.innerWidth  - 0.5) * -14;
                    tY = (e.clientY / window.innerHeight - 0.5) * -10;
                    if (!rafPx) rafPx = requestAnimationFrame(function() {
                        rafPx = null;
                        if (!document.body.classList.contains('perf-mode'))
                            bgEl.style.transform = `translate3d(${tX.toFixed(1)}px,${tY.toFixed(1)}px,0)`;
                    });
                });
            }
        }

        // ── 5. RIPPLE CLICK BURST ─────────────────────────
        document.addEventListener('click', function(e) {
            var profile = getMotionProfile();
            if (profile.reduced) return;
            var lowRipple = profile.lowEnd;
            var target = e.target.closest('.hover-target,.btn,.skill-badge,.sys-settings-btn,.builder-btn,.compact-status');
            if (!target) return;
            var r = target.getBoundingClientRect();
            var size = Math.max(r.width, r.height) * (lowRipple ? 0.88 : 1.6);
            var rip = document.createElement('span');
            rip.className = 'ripple-burst' + (lowRipple ? ' ripple-burst-soft' : '');
            rip.style.cssText =
                `width:${size}px;height:${size}px;` +
                `left:${(e.clientX - r.left - size / 2).toFixed(0)}px;` +
                `top:${(e.clientY - r.top  - size / 2).toFixed(0)}px;`;
            var prev = target.style.position;
            if (!prev || prev === 'static') target.style.position = 'relative';
            target.style.overflow = 'hidden';
            target.appendChild(rip);
            rip.addEventListener('animationend', function() { rip.remove(); });
        }, true);

        // ── 6. HERO TITLE GLITCH ON HOVER ─────────────────
        if (!isTouch) {
            var h1 = document.querySelector('.hero h1');
            if (h1) {
                var glitchIv = null;
                var origText = h1.textContent;
                var chaos = '!@#$%^&*<>{}[]|\\/?.,-=+~';
                h1.addEventListener('mouseenter', function() {
                    origText = h1.textContent;
                    var ticks = 0;
                    glitchIv = setInterval(function() {
                        ticks++;
                        h1.textContent = origText.split('').map(function(c) {
                            return (c !== ' ' && Math.random() > 0.65)
                                ? chaos[Math.floor(Math.random() * chaos.length)] : c;
                        }).join('');
                        if (ticks >= 10) { clearInterval(glitchIv); h1.textContent = origText; }
                    }, 55);
                });
                h1.addEventListener('mouseleave', function() {
                    clearInterval(glitchIv);
                    h1.textContent = origText;
                });
            }
        }

        // ── 7. DATA CARD TILT ─────────────────────────────
        function attachDataTilt() {
            if (isTouch) return;
            document.querySelectorAll('.data-card:not([data-tilt])').forEach(function(c) {
                c.dataset.tilt = '1';
                var writeDataTilt = function(x, y) { applyTilt(c, x, y, 5, 5); };
                c.addEventListener('mousemove', function(e) {
                    queuePointerWrite(c, e, writeDataTilt);
                });
                c.addEventListener('mouseleave', function() {
                    clearPointerWrite(c, function() { resetTilt(c); });
                });
            });
        }
        attachDataTilt();

        // ── 9. HUD CORNER BRACKET INJECTOR ────────────────
        var _sysCornerSelectors = [
            '.card', '.hero-stats', '.name-box',
            '.update-logs', '.modal-box', '.data-card', '.b-status'
        ];
        function injectSysCorners() {
            _sysCornerSelectors.forEach(function(sel) {
                document.querySelectorAll(sel).forEach(function(el) {
                    if (el.dataset.sysCorner) return;
                    el.dataset.sysCorner = '1';
                    ['tl','tr','bl','br'].forEach(function(pos) {
                        var s = document.createElement('span');
                        s.className = 'sys-corner sys-corner-' + pos;
                        s.setAttribute('aria-hidden','true');
                        el.appendChild(s);
                    });
                });
            });
        }
        injectSysCorners();
        var immersiveRefreshFrame = 0;
        new MutationObserver(function(records) {
            var hasRelevantAdditions = records.some(function(record) {
                return Array.from(record.addedNodes).some(function(node) {
                    return node.nodeType === 1 && !node.classList.contains('sys-corner');
                });
            });
            if (!hasRelevantAdditions || immersiveRefreshFrame) return;
            immersiveRefreshFrame = requestAnimationFrame(function() {
                immersiveRefreshFrame = 0;
                attachCardTilt();
                attachDataTilt();
                injectSysCorners();
            });
        }).observe(document.body, { childList: true, subtree: true });

    }());


