    // ======================================================
    // Site log helpers
    // ======================================================
    let systemLogsArray = [];
    window.currentLogFilter = 'ALL';

    window.sysLog = function(type, msg) {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        systemLogsArray.unshift({ time, type, msg });
        if (systemLogsArray.length > 200) systemLogsArray.pop();
        const modal = document.getElementById('systemLogsModal');
        if (modal && modal.classList.contains('show')) renderSystemLogs();
    };

    window.openSystemLogs = function() {
        document.getElementById('adminSelectionModal').classList.remove('show');
        hideToolbarForModal();
        document.getElementById('systemLogsModal').classList.add('show');
        SFX.modalOpen();
        renderSystemLogs();
        sysLog('SYSTEM', 'Log interface opened');
    };
    window.closeSystemLogs = function() { document.getElementById('systemLogsModal').classList.remove('show'); showToolbarForModal(); SFX.modalClose(); };
    window.filterLogs = function(type) {
        window.currentLogFilter = type;
        document.querySelectorAll('#systemLogsModal .builder-btn:not([onclick="clearLogs()"])').forEach(b => b.classList.remove('active'));
        const el = document.getElementById(`logFilter${type}`);
        if (el) el.classList.add('active');
        renderSystemLogs();
    };
    window.clearLogs = function() { systemLogsArray = []; sysLog('SYSTEM', 'Logs cleared by admin'); renderSystemLogs(); };
    function renderSystemLogs() {
        const grid = document.getElementById('logGrid');
        if (!grid) return;
        grid.innerHTML = '';
        let filtered = window.currentLogFilter === 'ALL' ? systemLogsArray : systemLogsArray.filter(l => l.type === window.currentLogFilter);
        if (filtered.length === 0) { grid.innerHTML = `<div style="color:#a1a1aa;font-family:monospace;">> No logs found for category: ${window.currentLogFilter}</div>`; return; }
        grid.innerHTML = filtered.map(log => `<div class="sys-log-row"><div class="sys-log-time">${log.time}</div><div class="sys-log-type l-${log.type}">[${log.type}]</div><div class="sys-log-msg">${log.msg}</div></div>`).join('');
    }

    window.adminData = {
        textEditor: {},
        uiBuilder: [],
        changelogs: [],
        sysConfig: {
            layout: { notice: true, about: true, explore: true, feedback: true },
            eggs: { virus: 3, glitch: 5, void: 1, meltdown: 2 },
            perf: { threshold: 30, auto: true, manualPerf: false },
            theme: 'default',
            migratedToUnifiedBuilder: false
        }
    };

    let sysConfig = window.adminData.sysConfig;
    let uiElements = window.adminData.uiBuilder;
    let perfModeActive = false, manualPerf = false;

    window.forceEmergencyUnlock = function(targetView) {
        console.warn("[SYSTEM] EMERGENCY UNLOCK TRIGGERED.");
        sysLog('ERROR', 'Timeout fallback triggered. Forcing UI state: ' + targetView);
        try {
            document.querySelectorAll('.cinematic-hud-container').forEach(el => el.remove());
            document.body.classList.remove("hacked-mode", "meltdown-active", "virus-chaos", "void-event", "glitch-event");
            ['loadingScreen', 'shutdownScreen', 'adminAuthTransition', 'hazardScreen'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.classList.remove('active', 'show'); el.style.opacity = '0'; el.style.pointerEvents = 'none'; }
            });
            if (targetView === 'main-view') {
                const lv = document.getElementById('login-view');
                if (lv) { lv.style.display = 'none'; lv.style.opacity = '0'; }
                const mv = document.getElementById('main-view');
                if (mv) { mv.style.display = 'block'; mv.style.opacity = '1'; mv.style.pointerEvents = 'auto'; }
                renderUIElements();
            } else if (targetView === 'login-view') {
                const mv = document.getElementById('main-view');
                if (mv) { mv.style.display = 'none'; mv.style.opacity = '0'; }
                const lv = document.getElementById('login-view');
                if (lv) { lv.style.display = 'flex'; lv.style.opacity = '1'; lv.style.pointerEvents = 'auto'; }
            }
        } catch(e) { console.error("Failsafe also failed:", e); }
    };

    window.hideToolbarForModal = function() {
        if (document.getElementById('uiBuilderToolbar').classList.contains('active'))
            document.getElementById('uiBuilderToolbar').classList.add('hidden-by-modal');
    };
    window.showToolbarForModal = function() { document.getElementById('uiBuilderToolbar').classList.remove('hidden-by-modal'); };

    window.getDefaultUIElements = function() {
        let txt = window.adminData.textEditor || {};
        const keep = (key, value) => {
            if (!txt[key]) txt[key] = value;
            return txt[key];
        };

        keep('cms-modal-games-title', 'Games Hub');
        keep('cms-modal-games-content', "<div class=\"portfolio-modal-copy\">Games are where I study pacing, feedback, UI clarity, and how small systems keep people engaged.</div>\n<ul class=\"portfolio-modal-list\">\n<li>Roblox Studio experiments and gameplay ideas</li>\n<li>UI references from games I enjoy</li>\n<li>Small mechanics I want to rebuild and understand</li>\n</ul>");
        keep('cms-modal-projects-title', 'Project Lab');
        keep('cms-modal-projects-content', "<div class=\"portfolio-modal-copy\">My current focus is building web experiences that feel clean, fast, and personal. This portfolio is the main live project.</div>\n<ul class=\"portfolio-modal-list\">\n<li>JoshRTX personal website with editable portfolio sections</li>\n<li>Responsive motion, admin tools, and polished portfolio sections</li>\n<li>Admin tools for feedback, changelogs, and UI editing</li>\n</ul>");
        keep('cms-modal-books-title', 'Learning Notes');
        keep('cms-modal-books-content', "<div class=\"portfolio-modal-copy\">This space tracks what I am learning and the lessons I want to keep.</div>\n<ul class=\"portfolio-modal-list\">\n<li>Frontend structure, layout, and responsive design</li>\n<li>JavaScript interaction patterns</li>\n<li>BSIT notes and ideas from class projects</li>\n</ul>");
        keep('cms-modal-contact-title', 'Contact');
        keep('cms-modal-contact-content', 'Send a message, idea, bug report, or collaboration note. I read these like site diagnostics.');
        keep('cms-modal-contributions-title', 'Credits');
        keep('cms-modal-contributions-content', "<div class=\"portfolio-modal-copy\">This build is personal, but it is shaped by feedback, classmates, references, tutorials, and people who pushed me to keep improving.</div>\n<ul class=\"portfolio-modal-list\">\n<li>Design feedback and bug reports</li>\n<li>Programming lessons and class work</li>\n<li>Game, music, and web inspiration</li>\n</ul>");

        return [
            { id: 'el_notice', type: 'notice', title: txt['cms-notice-title'] || 'BUILD NOTE:', content: txt['cms-notice-content'] || 'Live portfolio in progress. I keep improving the design, editing tools, sounds, and project sections as I learn.' },
            { id: 'el_portfolio_intro', type: 'text', content: "<section class=\"portfolio-brief\">\n    <div>\n        <div class=\"portfolio-kicker\">Portfolio Overview</div>\n        <h2 class=\"section-title\">__PROFILE_TITLE__</h2>\n        <p>BSIT student, frontend learner, gamer, and builder of small web tools. This site is my personal lab for UI, code, motion, sound, and experiments that slowly become real projects.</p>\n    </div>\n    <div class=\"portfolio-chip-row\">\n        <span>Frontend</span>\n        <span>Game Ideas</span>\n        <span>UI Systems</span>\n        <span>Learning Log</span>\n    </div>\n</section>".replace('__PROFILE_TITLE__', txt['cms-profile-title'] || 'About Josh') },
            { id: 'el_profile', type: 'card', title: txt['cms-profile-greeting'] || 'Hi, I am Josh.', content: txt['cms-profile-desc'] || 'I like turning ideas into interfaces that feel alive. Right now I am learning web development, improving this portfolio, building small tools, and collecting progress from school, games, and coding practice.' },
            { id: 'el_snapshot', type: 'text', content: "<section class=\"portfolio-snapshot\" aria-label=\"Portfolio snapshot\">\n    <div class=\"portfolio-metric\"><span>01</span><strong>Live Site</strong><p>Personal portfolio with custom intro, sounds, editor, and admin tools.</p></div>\n    <div class=\"portfolio-metric\"><span>02</span><strong>Current Stack</strong><p>HTML, CSS, JavaScript, Firebase, and browser-based UI experiments.</p></div>\n    <div class=\"portfolio-metric\"><span>03</span><strong>Direction</strong><p>Cleaner projects, better responsive design, and more useful interactive tools.</p></div>\n</section>" },
            { id: 'el_focus_title', type: 'text', content: '<h2 class="section-title">Current Focus</h2>' },
            { id: 'el_focus_panel', type: 'text', content: "<section class=\"portfolio-focus\">\n    <div class=\"portfolio-focus-main\">\n        <div class=\"portfolio-kicker\">Now Building</div>\n        <h3>JoshRTX Web Portfolio</h3>\n        <p>A personal website that mixes project cards, editable content, admin controls, intro animation, sounds, and polished responsive motion into one finished experience.</p>\n    </div>\n    <div class=\"portfolio-pipeline\">\n        <span><b>Design</b> premium cyber UI</span>\n        <span><b>Code</b> cleaner frontend interactions</span>\n        <span><b>Study</b> BSIT and practical web dev</span>\n        <span><b>Build</b> game and tool ideas</span>\n    </div>\n</section>" },
            { id: 'el_title2', type: 'text', content: '<h2 class="section-title">' + (txt['cms-explore-title'] || 'Explore Portfolio') + '</h2>' },
            { id: 'el_games', type: 'popup-card', title: txt['cms-menu1-title'] || '01 // Games', content: txt['cms-menu1-desc'] || 'Gameplay ideas, Roblox experiments, and mechanics I want to learn from.', target: 'games' },
            { id: 'el_proj', type: 'popup-card', title: txt['cms-menu2-title'] || '02 // Projects', content: txt['cms-menu2-desc'] || 'Web builds, class work, tools, and experiments from my coding practice.', target: 'projects' },
            { id: 'el_books', type: 'popup-card', title: txt['cms-menu3-title'] || '03 // Notes', content: txt['cms-menu3-desc'] || 'Lessons, references, progress logs, and ideas I want to remember.', target: 'books' },
            { id: 'el_cont', type: 'popup-card', title: txt['cms-menu4-title'] || '04 // Contact', content: txt['cms-menu4-desc'] || 'Send feedback, ideas, bugs, or collaboration notes.', target: 'contact' },
            { id: 'el_arch', type: 'popup-card', title: txt['cms-menu5-title'] || '05 // Credits', content: txt['cms-menu5-desc'] || 'People, feedback, and inspiration that helped this build improve.', target: 'contributions' },
            { id: 'el_skills_title', type: 'text', content: '<h2 class="section-title">Skill Matrix</h2>' },
            { id: 'el_skills_matrix', type: 'text', content: "<section class=\"portfolio-skill-matrix\">\n    <div class=\"skill-track\"><span>HTML/CSS</span><i style=\"--level:82%\"></i></div>\n    <div class=\"skill-track\"><span>JavaScript</span><i style=\"--level:68%\"></i></div>\n    <div class=\"skill-track\"><span>UI Design</span><i style=\"--level:74%\"></i></div>\n    <div class=\"skill-track\"><span>Roblox Studio</span><i style=\"--level:62%\"></i></div>\n</section>" },
            { id: 'el_status', type: 'status', content: 'PORTFOLIO ONLINE // STILL LEARNING, STILL BUILDING' },
            { id: 'el_out', type: 'button', content: 'Leave Site', url: 'javascript:systemLogout()', isDisconnect: true }
        ];
    };

    window.upgradePortfolioLayout = function(elements) {
        if (!Array.isArray(elements) || elements.length === 0) return window.getDefaultUIElements();
        const hasPortfolioRevamp = elements.some(el => el && (el.id === 'el_portfolio_intro' || el.id === 'el_focus_panel' || el.id === 'el_skills_matrix'));
        const looksLikeLegacyDefault = elements.some(el => el && el.id === 'el_profile') &&
            elements.some(el => el && el.id === 'el_games') &&
            elements.some(el => el && el.id === 'el_proj');
        if (!hasPortfolioRevamp && looksLikeLegacyDefault) return window.getDefaultUIElements();
        return elements;
    };



    window.cleanLegacyCmsCopy = function(data) {
        if (!data) return data;
        const replacements = [
            ['⚠ SYSTEM NOTICE:', '⚠ BUILD NOTE:'],
            ['This website is currently in beta.', 'Still in beta. I test it live and keep improving it whenever I learn something new.'],
            ['Built and coded entirely on' + ' mobile.', ''],
            ['Initialize Profile', 'About Josh'],
            ['INITIALIZE PROFILE', 'ABOUT JOSH'],
            ['I love technology, programming, gaming, and web development.\nThis website is my digital space where I share my journey, interests, and future projects.\nWelcome to the nexus.', "I'm a BSIT student who builds small web experiments, Roblox ideas, and tools I can actually use. This page keeps my progress, notes, and projects in one place while I learn."],
            ['Explore Data', 'Explore'],
            ['EXPLORE DATA', 'EXPLORE'],
            ['Active gaming log', 'Games I play and clips I like'],
            ['Things I am building', 'Web experiments and class projects'],
            ['Chapters & Journey', 'Notes, lessons, and progress'],
            ['Social networks', 'Links and messages'],
            ['System architects', 'People who helped and inspired this build'],
            ['Logout', 'Leave Site']
        ];
        const clean = (value) => {
            if (typeof value !== 'string') return value;
            return replacements.reduce((text, [from, to]) => text.split(from).join(to), value);
        };

        if (data.textEditor) {
            Object.keys(data.textEditor).forEach(key => { data.textEditor[key] = clean(data.textEditor[key]); });
        }
        if (Array.isArray(data.uiBuilder)) {
            data.uiBuilder.forEach(el => {
                ['title', 'content'].forEach(key => { if (key in el) el[key] = clean(el[key]); });
            });
            if (window.upgradePortfolioLayout) data.uiBuilder = window.upgradePortfolioLayout(data.uiBuilder);
        }
        return data;
    };

    let saveToastTimer;
    function showSaveToast(type, msg) {
        const toast = document.getElementById('saveToast');
        toast.className = `save-toast show ${type}`;
        toast.innerHTML = msg;
        clearTimeout(saveToastTimer);
        if (type === 'success') saveToastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    async function saveWithNotification(savePromise, successMsg = "✓ Changes Saved") {
        if (!navigator.onLine) {
            showSaveToast("error", "✕ Save Failed<br><span style='font-size:0.8rem;font-weight:normal;'>Reason: No Internet Connection</span><br><button onclick='this.parentNode.classList.remove(\"show\")' style='margin-top:8px;background:rgba(255,255,255,0.2);color:#fff;border:1px solid #fff;padding:4px 10px;border-radius:4px;font-family:monospace;cursor:pointer;'>Dismiss</button>");
            return false;
        }
        showSaveToast("loading", "Saving Changes...");
        document.body.style.pointerEvents = 'none';
        try {
            let res = await savePromise;
            document.body.style.pointerEvents = 'auto';
            if (res && res.success === false) throw new Error(res.error || "Save Failed");
            if (res === false) throw new Error("Database Write Failed");
            let time = new Date().toLocaleTimeString('en-US', { hour12: true });
            const ddSave = document.getElementById('ddSave');
            if (ddSave) ddSave.innerText = time;
            showSaveToast("success", `${successMsg}<br><span style='font-size:0.8rem;font-weight:normal;'>Last Saved: ${time}</span>`);
            sysLog('FIREBASE', `Save Operation Successful: ${successMsg}`);
            return true;
        } catch(e) {
            document.body.style.pointerEvents = 'auto';
            showSaveToast("error", `✕ Save Failed<br><span style='font-size:0.8rem;font-weight:normal;'>Reason: ${e.message}</span><br><button onclick='this.parentNode.classList.remove(\"show\")' style='margin-top:8px;background:rgba(255,255,255,0.2);color:#fff;border:1px solid #fff;padding:4px 10px;border-radius:4px;font-family:monospace;cursor:pointer;'>Dismiss</button>`);
            sysLog('ERROR', `Save Operation Failed: ${e.message}`);
            return false;
        }
    }

    // ======================================================
    // Event overlays
    // ======================================================
    function createCinematicHUD(title, subtitle, typeClass) {
        const cont = document.createElement('div');
        cont.className = 'cinematic-hud-container';
        const fxLayer = document.createElement('div');
        fxLayer.className = `screen-fx-layer ${typeClass}-fx`;
        const textWrap = document.createElement('div');
        textWrap.className = `hud-text ${typeClass}-text`;
        let html = '';
        if (title) html += `<div class="hud-title">${title}</div>`;
        if (subtitle) html += `<div class="hud-subtitle">${subtitle}</div>`;
        textWrap.innerHTML = html;
        cont.appendChild(fxLayer);
        cont.appendChild(textWrap);
        // Put overlays outside body transforms so fixed positioning stays steady.
        document.documentElement.appendChild(cont);
        return { container: cont, textWrapper: textWrap, fxLayer };
    }

    window.triggerVoidEvent = async function() {
        sysLog('EVENT', 'Void event activated');
        document.body.classList.add('void-event');
        triggerHaptic('heavy');
        SFX.eggVoid();
        const hud = createCinematicHUD('SIGNAL RESTORED', 'UNKNOWN ROUTE STABILIZED', 'void');
        hud.textWrapper.style.opacity = '0';
        hud.textWrapper.style.transition = 'opacity 2s ease-in-out';
        await sleep(2000);
        hud.textWrapper.style.opacity = '1';
        await sleep(4000);
        hud.textWrapper.style.opacity = '0';
        await sleep(2000);
        document.body.classList.remove('void-event');
        setTimeout(() => hud.container.remove(), 500);
    };

    window.triggerGlitchEvent = function() {
        sysLog('EVENT', 'Idle glitch detected');
        document.body.classList.add('glitch-event');
        triggerHaptic('error');
        SFX.eggGlitch();
        const hud = createCinematicHUD('SIGNAL DRIFT', 'VISUAL LAYER RECOVERING', 'glitch');
        hud.textWrapper.style.opacity = '1';
        setTimeout(() => { document.body.classList.remove('glitch-event'); hud.container.remove(); }, 400 + Math.random() * 600);
    };

    async function executeMeltdownEvent(userName) {
        let fallback = setTimeout(() => forceEmergencyUnlock('main-view'), 15000);
        try {
            sysLog('EVENT', 'Meltdown Sequence Initiated');
            document.body.classList.add('meltdown-active');
            const hud = createCinematicHUD('CORE WARNING', 'RECOVERY PROTOCOL ONLINE', 'meltdown');
            hud.textWrapper.style.opacity = '1';
            triggerHaptic('error'); SFX.eggMeltdown();
            for (let i = 0; i < 15; i++) {
                sysLog('ERROR', `MEM_CORRUPTION 0x${genHex()} AT SECTOR ${i}`);
                triggerHaptic('tap'); SFX.loginTick();
                await sleep(150 + Math.random() * 200);
            }
            hud.textWrapper.innerHTML = `<div class="hud-title">RECOVERY MODE</div><div class="hud-subtitle">REBUILDING SESSION SAFELY</div>`;
            hud.textWrapper.style.color = '#fff'; hud.textWrapper.style.textShadow = '0 0 30px #ef4444';
            sysLog('ERROR', 'IMMINENT TOTAL FAILURE');
            triggerHaptic('heavy'); SFX.error();
            await sleep(2000);
            sysLog('SYSTEM', 'Emergency Recovery Protocols Engaged');
            document.body.classList.remove('meltdown-active');
            hud.container.remove();
            triggerHaptic('success'); SFX.success();
            sysLog('EVENT', 'Meltdown Averted');
            if (userName && userName !== "ADMIN_TEST") initSystem(userName);
        } catch(e) { sysLog('ERROR', `Meltdown Sequence Failed: ${e.message}`); }
        finally { clearTimeout(fallback); }
    }

    window.previewVoidEvent = async function() { if (window.closeSysManager) closeSysManager(); await triggerVoidEvent(); };
    window.previewGlitchEvent = function() { if (window.closeSysManager) closeSysManager(); triggerGlitchEvent(); };
    window.testVirus = function() { if (window.closeSysManager) closeSysManager(); executeVirusPhase1("ADMIN_TEST"); };
    window.triggerMeltdownEvent = async function() { if (window.closeSysManager) closeSysManager(); await executeMeltdownEvent("ADMIN_TEST"); };

    async function executeVirusPhase1(userName) {
        let fallback = setTimeout(() => forceEmergencyUnlock('login-view'), 15000);
        try {
            sysLog('EVENT', 'Virus Phase 1 Initiated');
            const loader = document.getElementById("loadingScreen");
            const termOut = document.getElementById("terminalOutput");
            const loadBar = document.getElementById("loadBar");
            document.body.classList.add("hacked-mode"); loader.classList.add("active");
            termOut.innerHTML = `<div class="term-line red-error">FATAL ERROR DETECTED FOR: ${userName}</div>`; loadBar.style.width = "0%";
            triggerHaptic('error'); SFX.eggVirus(); await sleep(800);
            for (let i = 0; i < 40; i++) {
                termOut.innerHTML += `<div class="term-line red-error" style="font-size:0.8rem;margin:0;"><span class="hex">0x${genHex()}</span> CRITICAL_MEM_CORRUPTION_AT_SECTOR_${genHex()}</div>`;
                termOut.scrollTop = termOut.scrollHeight; loadBar.style.width = (i * 2.5) + "%";
                if (i % 5 === 0) { triggerHaptic('load_tick'); SFX.loginTick(); }
                await sleep(30);
            }
            termOut.innerHTML += `<div class="term-line red-error" style="font-size:2.5rem;margin-top:20px;">SYSTEM CRASH</div>`;
            termOut.scrollTop = termOut.scrollHeight; triggerHaptic('heavy'); SFX.error(); await sleep(1000);
            document.body.classList.remove("hacked-mode"); triggerFakeRefresh();
        } finally { clearTimeout(fallback); }
    }

    async function executeVirusPhase2(userName) {
        let fallback = setTimeout(() => forceEmergencyUnlock('login-view'), 20000);
        try {
            sysLog('EVENT', 'Virus Phase 2 Initiated');
            const loader = document.getElementById("loadingScreen");
            const termOut = document.getElementById("terminalOutput");
            const loadBar = document.getElementById("loadBar");
            resetLoaderToNormal(); loader.classList.add("active"); termOut.innerHTML = ""; loadBar.style.width = "0%"; await sleep(400);
            for (let i = 0; i <= 30; i++) {
                let txt = i === 30 ? `ACCESS GRANTED. Welcome back, ${userName}.` : `Re-indexing 0x${genHex()}... [OK]`;
                let styling = i === 30 ? 'style="color:var(--c-prim);font-size:1.4rem;font-weight:bold;margin-top:20px;text-shadow:0 0 15px var(--c-prim);"' : '';
                termOut.innerHTML += `<div class="term-line" ${styling}><span class="hex">0x${genHex()}</span><span>></span> ${txt}</div>`;
                termOut.scrollTop = termOut.scrollHeight; loadBar.style.width = ((i) / 30 * 100) + "%"; await sleep(40 + Math.random() * 60);
            }
            await sleep(800);
            const loginView = document.getElementById("login-view"), mainView = document.getElementById("main-view");
            loginView.style.display = "none"; loader.classList.remove("active"); mainView.style.display = "block"; mainView.style.opacity = "1";
            const fbBtn = document.getElementById('section-feedback'); if (fbBtn) setTimeout(() => { fbBtn.style.opacity = '1'; }, 300);
            setTimeout(() => { document.querySelectorAll('.reveal').forEach(el => window.scrollObserver && window.scrollObserver.observe(el)); }, 100);
            await sleep(4000); document.body.classList.add("virus-chaos"); triggerHaptic('error'); SFX.error(); await sleep(800);
            document.body.classList.remove("virus-chaos"); triggerFakeRefresh();
        } finally { clearTimeout(fallback); }
    }

    async function triggerFakeRefresh() {
        const loader = document.getElementById("loadingScreen");
        const flash = document.createElement("div");
        flash.style.cssText = "position:fixed;inset:0;background:#fff;z-index:999999;";
        document.body.appendChild(flash);
        await sleep(150); loader.classList.remove("active");
        document.getElementById("main-view").style.display = "none";
        const lv = document.getElementById("login-view");
        lv.style.display = "flex"; lv.style.opacity = "1"; lv.style.pointerEvents = 'auto';
        document.getElementById("guestNameInput").value = "";
        document.getElementById('enterBtn').style.pointerEvents = 'auto';
        flash.style.transition = "opacity 0.4s ease"; flash.style.opacity = "0";
        await sleep(400); flash.remove();
    }

    async function executeFinalDestruction(userName) {
        let fallback = setTimeout(() => executeFake404(), 25000);
        try {
            sysLog('EVENT', 'Final Purge Event Initiated');
            const loader = document.getElementById("loadingScreen");
            const termOut = document.getElementById("terminalOutput");
            const loadBar = document.getElementById("loadBar");
            document.body.classList.add("hacked-mode"); loader.classList.add("active");
            termOut.innerHTML = `<div class="term-line red-error">SYSTEM INTEGRITY COMPROMISED. INITIATING PURGE...</div>`; loadBar.style.width = "0%"; triggerHaptic('error'); await sleep(800);
            for (let i = 0; i < 25; i++) { termOut.innerHTML += `<div class="term-line red-error" style="font-size:0.8rem;margin:0;"><span class="hex">0x${genHex()}</span> DELETING CORE FILES [ ${genHex()} ]...</div>`; termOut.scrollTop = termOut.scrollHeight; loadBar.style.width = (i * 1.5) + "%"; await sleep(40); }
            await sleep(600); document.body.classList.remove("hacked-mode");
            termOut.innerHTML += `<div class="term-line" style="color:var(--c-prim);font-size:1.4rem;font-weight:bold;margin-top:20px;text-shadow:0 0 15px var(--c-prim);">[ JOSHRTX DEFENDER ONLINE ]</div>`;
            termOut.scrollTop = termOut.scrollHeight; loadBar.style.background = "var(--c-prim)"; loadBar.style.boxShadow = "0 0 20px var(--c-prim)"; triggerHaptic('success'); SFX.success(); await sleep(1000);
            for (let i = 10; i <= 65; i += 5) { loadBar.style.width = (37 + (i / 2)) + "%"; await sleep(150 + Math.random() * 200); }
            await sleep(600); document.body.classList.add("hacked-mode");
            termOut.innerHTML += `<div class="term-line red-error" style="font-size:1.5rem;font-weight:bold;">NICE TRY.</div>`;
            termOut.scrollTop = termOut.scrollHeight; loadBar.style.background = "red"; loadBar.style.boxShadow = "0 0 20px red"; triggerHaptic('error'); SFX.error(); await sleep(1000);
            for (let i = 0; i < 40; i++) { termOut.innerHTML += `<div class="term-line red-error" style="font-size:0.8rem;margin:0;"><span class="hex">0x${genHex()}</span> OVERRIDING SYSTEM NODE ${genHex()}...</div>`; termOut.scrollTop = termOut.scrollHeight; loadBar.style.width = (65 + i) + "%"; await sleep(25); }
            termOut.innerHTML += `<div class="term-line red-error" style="font-size:2.5rem;margin-top:20px;">KERNEL PANIC</div>`; termOut.scrollTop = termOut.scrollHeight; loadBar.style.width = "100%"; triggerHaptic('heavy'); await sleep(1200);
            const flash = document.createElement("div"); flash.style.cssText = "position:fixed;inset:0;background:#fff;z-index:999999;"; document.body.appendChild(flash);
            await sleep(150); loader.classList.remove("active"); flash.style.transition = "opacity 0.4s ease"; flash.style.opacity = "0"; await sleep(400); flash.remove();
            await sleep(500); document.body.classList.add("virus-chaos"); await sleep(3500); executeFake404();
        } finally { clearTimeout(fallback); }
    }

    function executeFake404() {
        document.documentElement.innerHTML = `<head><title>404 Not Found</title></head><body style="background-color:white;color:black;font-family:'Times New Roman',Times,serif;text-align:center;padding-top:10%;margin:0;cursor:auto;"><h1 style="font-size:2.5rem;font-weight:normal;margin-bottom:20px;">404 Not Found</h1><hr style="border:0;height:1px;background:#ccc;width:90%;margin:auto;"><p style="font-size:1.1rem;margin-top:20px;">nginx</p>`;
    }