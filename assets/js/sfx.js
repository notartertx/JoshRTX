    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const genHex = () => Math.random().toString(16).slice(2, 10).toUpperCase();

    // ======================================================
    // SOUND ENGINE — Procedural Web Audio API
    // All sounds are synthesized, no external files needed.
    // AudioContext is created on the first user gesture.
    // ======================================================
    const SFX = (() => {
        let ctx = null;
        let masterGain = null;
        let _unlocked = false;
        let _muted = false;

        function init() {
            if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
            try {
                ctx = new (window.AudioContext || window.webkitAudioContext)();
                masterGain = ctx.createGain();
                _muted = localStorage.getItem('sfx_muted') === 'true';
                masterGain.gain.value = _muted ? 0 : 0.8;
                // Limiter: prevents ANY clipping / distortion no matter what sounds play
                const limiter = ctx.createDynamicsCompressor();
                limiter.threshold.value = -3;
                limiter.knee.value = 2;
                limiter.ratio.value = 20;
                limiter.attack.value = 0.001;
                limiter.release.value = 0.1;
                masterGain.connect(limiter);
                limiter.connect(ctx.destination);
                _unlocked = true;
            } catch(e) { console.warn('Web Audio not supported:', e); }
        }

        function tone(freq, dur, type = 'sine', vol = 0.3, delay = 0, attack = 0.01, release = null) {
            if (!ctx || !_unlocked) return;
            const now = ctx.currentTime + delay;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            osc.connect(g); g.connect(masterGain);
            const rel = release !== null ? release : dur * 0.7;
            g.gain.setValueAtTime(0, now);
            g.gain.linearRampToValueAtTime(vol, now + Math.min(attack, dur));
            g.gain.setValueAtTime(vol, now + dur - rel);
            g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            osc.start(now); osc.stop(now + dur + 0.02);
        }

        function sweep(f1, f2, dur, type = 'sine', vol = 0.25, delay = 0) {
            if (!ctx || !_unlocked) return;
            const now = ctx.currentTime + delay;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(f1, now);
            osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), now + dur);
            osc.connect(g); g.connect(masterGain);
            g.gain.setValueAtTime(0, now);
            g.gain.linearRampToValueAtTime(vol, now + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            osc.start(now); osc.stop(now + dur + 0.02);
        }

        function noise(dur, vol = 0.1, delay = 0, filterFreq = 1000) {
            if (!ctx || !_unlocked) return;
            const now = ctx.currentTime + delay;
            const bufSize = Math.ceil(ctx.sampleRate * dur);
            const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const filt = ctx.createBiquadFilter();
            filt.type = 'bandpass';
            filt.frequency.value = filterFreq;
            filt.Q.value = 1.5;
            const g = ctx.createGain();
            src.connect(filt); filt.connect(g); g.connect(masterGain);
            g.gain.setValueAtTime(vol, now);
            g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            src.start(now); src.stop(now + dur + 0.02);
        }

        // Digital beep — sharp square/saw tone, no musical sustain
        function digiBeep(freq, dur, vol = 0.12, delay = 0, type = 'square') {
            if (!ctx || !_unlocked) return;
            const now = ctx.currentTime + delay;
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = type; o.frequency.value = freq;
            o.connect(g); g.connect(masterGain);
            g.gain.setValueAtTime(0, now);
            g.gain.linearRampToValueAtTime(vol, now + 0.002);
            g.gain.setValueAtTime(vol, now + Math.max(0, dur - 0.04));
            g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            o.start(now); o.stop(now + dur + 0.02);
        }

        return {
            init,
            isUnlocked: () => _unlocked,

            // UI interactions — techy digital
            hover() {
                noise(0.007, 0.05, 0, 5500);
                digiBeep(3200, 0.012, 0.025);
            },
            click() {
                noise(0.014, 0.2, 0, 4000);
                digiBeep(160, 0.055, 0.13, 0, 'square');
                digiBeep(1800, 0.02, 0.06, 0.008);
            },
            modalOpen() {
                noise(0.06, 0.14, 0, 3200);
                sweep(220, 1400, 0.2, 'sawtooth', 0.08);
                digiBeep(1400, 0.08, 0.08, 0.07);
                digiBeep(2000, 0.06, 0.05, 0.13);
            },
            modalClose() {
                sweep(1400, 220, 0.15, 'sawtooth', 0.08);
                noise(0.05, 0.10, 0, 3000);
            },
            success() {
                noise(0.06, 0.12, 0, 3500);
                [600, 900, 1200, 1800].forEach((f, i) => {
                    digiBeep(f, 0.07, 0.10, i * 0.055, 'square');
                    noise(0.018, 0.07, i * 0.055 + 0.01, 3000);
                });
                sweep(1800, 3600, 0.22, 'sawtooth', 0.05, 0.25);
            },
            error() {
                digiBeep(100, 0.32, 0.22, 0, 'sawtooth');
                noise(0.28, 0.14, 0.02, 400);
                sweep(500, 80, 0.22, 'sawtooth', 0.12, 0.05);
            },
            loginTick() {
                noise(0.007, 0.12, 0, 5000);
                digiBeep(1200 + Math.random() * 800, 0.018, 0.07);
            },
            transmit() {
                for (let i = 0; i < 4; i++) {
                    noise(0.014, 0.10, i * 0.045, 4500);
                    digiBeep(1600 + i * 180, 0.022, 0.08, i * 0.045);
                }
                sweep(600, 2400, 0.18, 'sawtooth', 0.06, 0.02);
            },
            notif() {
                digiBeep(900, 0.07, 0.13);
                digiBeep(1350, 0.07, 0.10, 0.09);
                noise(0.02, 0.06, 0.09, 4000);
            },
            hapticTone() { digiBeep(200, 0.04, 0.07); },

            // Mute controls
            toggleMute() {
                _muted = !_muted;
                if (masterGain) masterGain.gain.value = _muted ? 0 : 0.8;
                localStorage.setItem('sfx_muted', _muted ? 'true' : 'false');
                const btn = document.getElementById('muteBtn');
                if (btn) btn.textContent = _muted ? '🔇' : '🔊';
            },
            getMuted() { return _muted; },

            // Shutdown — descending digital power-off
            shutdown() {
                noise(0.12, 0.12, 0, 2000);
                [1400, 1000, 700, 420, 240, 120, 60].forEach((f, i) => {
                    digiBeep(f, 0.12, 0.13 - i * 0.01, i * 0.12, 'square');
                });
                sweep(300, 18, 1.4, 'sawtooth', 0.18, 0.25);
                tone(35, 1.2, 'sine', 0.12, 0.9);
            },

            // CRT power-off — high-freq discharge
            crtPowerOff() {
                sweep(7000, 40, 0.5, 'sawtooth', 0.12);
                noise(0.06, 0.22, 0, 6000);
                digiBeep(60, 0.4, 0.14, 0.28, 'sine');
            },

            // Credential scan — rapid digital ping sequence
            credentialScan() {
                for (let i = 0; i < 7; i++) {
                    noise(0.018, 0.08, i * 0.13, 4000);
                    digiBeep(800 + i * 120, 0.06, 0.10, i * 0.13);
                }
                sweep(400, 2400, 0.9, 'sawtooth', 0.05, 0.1);
            },

            // Admin open — secure access granted
            adminOpen() {
                noise(0.08, 0.14, 0, 2500);
                sweep(150, 900, 0.45, 'sawtooth', 0.12);
                digiBeep(600, 0.1, 0.12, 0.12);
                digiBeep(900, 0.12, 0.10, 0.22);
                digiBeep(1200, 0.15, 0.08, 0.34);
            },

            // Transmit payload — data packet burst
            transmitPayload() {
                for (let i = 0; i < 5; i++) {
                    noise(0.016, 0.09, i * 0.04, 4200);
                    digiBeep(1000 + i * 220, 0.025, 0.09, i * 0.04);
                }
                sweep(300, 2200, 0.38, 'sawtooth', 0.07, 0.18);
            },

            // Feedback packing — data compression
            feedbackPacking() {
                noise(0.04, 0.10, 0, 3500);
                digiBeep(800, 0.06, 0.09);
                digiBeep(1100, 0.07, 0.07, 0.07);
                digiBeep(1400, 0.06, 0.06, 0.14);
            },

            // Feedback uplink — transmission start
            feedbackUplink() {
                sweep(400, 1800, 0.5, 'sawtooth', 0.08);
                noise(0.06, 0.08, 0.12, 3000);
                digiBeep(1800, 0.08, 0.07, 0.22);
                digiBeep(2200, 0.06, 0.05, 0.34);
            },

            // Feedback success — uplink confirmed
            feedbackSuccess() {
                noise(0.07, 0.12, 0, 3500);
                [500, 700, 1000, 1400, 1800].forEach((f, i) => {
                    digiBeep(f, 0.08, 0.10, i * 0.058, 'square');
                });
                sweep(1800, 4000, 0.3, 'sawtooth', 0.05, 0.32);
            },

            // Easter egg — Void event (eerie, low, space-like)
            eggVoid() {
                sweep(120, 40, 2.5, 'sine', 0.2);
                noise(2.0, 0.07, 0, 150);
                tone(60, 2.0, 'sine', 0.12);
                sweep(80, 200, 1.5, 'triangle', 0.08, 0.8);
            },

            // Easter egg — Glitch event (harsh, stutter, digital)
            eggGlitch() {
                for (let i = 0; i < 6; i++) {
                    const f = 200 + Math.random() * 1800;
                    tone(f, 0.04 + Math.random() * 0.06, 'square', 0.15, i * 0.04);
                }
                noise(0.3, 0.15, 0, 3000);
                sweep(1800, 200, 0.2, 'sawtooth', 0.18);
            },

            // Easter egg — Meltdown event (industrial klaxon + sub bass drop)
            eggMeltdown() {
                tone(35, 2.5, 'sine', 0.25);
                tone(55, 2.0, 'sawtooth', 0.18, 0.1);
                const klaxonPairs = [[180, 260], [180, 260], [150, 230]];
                klaxonPairs.forEach(([f1, f2], i) => {
                    const t = i * 0.7;
                    tone(f1, 0.28, 'square', 0.2, t);
                    tone(f2, 0.28, 'square', 0.18, t + 0.14);
                    tone(f1, 0.28, 'square', 0.2, t + 0.28);
                    tone(f2, 0.28, 'square', 0.18, t + 0.42);
                });
                noise(0.5, 0.18, 0, 1200);
                noise(0.4, 0.12, 0.8, 600);
                sweep(600, 30, 2.5, 'sawtooth', 0.22, 0.2);
                sweep(2200, 1100, 0.6, 'square', 0.08, 0.3);
            },

            // Easter egg — Virus event (corrupted, glitchy crash)
            eggVirus() {
                noise(0.6, 0.2, 0, 800);
                sweep(1000, 50, 0.8, 'sawtooth', 0.25);
                for (let i = 0; i < 8; i++) tone(50 + Math.random() * 400, 0.06, 'sawtooth', 0.12, i * 0.05);
                noise(0.4, 0.15, 0.5, 200);
            },

            // Intro sequence - smooth portfolio launch
            introTap() {
                noise(0.035, 0.055, 0, 5400);
                tone(196, 0.13, 'sine', 0.07, 0, 0.01);
                tone(392, 0.18, 'triangle', 0.055, 0.055, 0.015);
                tone(784, 0.20, 'sine', 0.032, 0.11, 0.012);
                sweep(620, 1900, 0.34, 'sine', 0.035, 0.02);
            },
            introBed() {
                if (!ctx || !_unlocked) return null;
                const low = ctx.createOscillator();
                const mid = ctx.createOscillator();
                const air = ctx.createOscillator();
                const lfo = ctx.createOscillator();
                const lfoGain = ctx.createGain();
                const lowGain = ctx.createGain();
                const midGain = ctx.createGain();
                const airGain = ctx.createGain();
                const filter = ctx.createBiquadFilter();
                const out = ctx.createGain();
                const now = ctx.currentTime;
                low.type = 'sine'; low.frequency.value = 49;
                mid.type = 'triangle'; mid.frequency.value = 98;
                air.type = 'sine'; air.frequency.value = 1174.66;
                lfo.frequency.value = 0.16; lfoGain.gain.value = 5;
                lfo.connect(lfoGain); lfoGain.connect(mid.frequency);
                lowGain.gain.value = 0.78; midGain.gain.value = 0.25; airGain.gain.value = 0.026;
                filter.type = 'lowpass'; filter.frequency.value = 680; filter.Q.value = 1.2;
                low.connect(lowGain); lowGain.connect(filter);
                mid.connect(midGain); midGain.connect(filter);
                air.connect(airGain); airGain.connect(filter);
                filter.connect(out); out.connect(masterGain);
                out.gain.setValueAtTime(0.0001, now);
                out.gain.exponentialRampToValueAtTime(0.13, now + 1.05);
                low.start(now); mid.start(now); air.start(now); lfo.start(now);
                return { _oscs: [low, mid, air, lfo], _g: out };
            },
            introStep(i) {
                const base = [293.66, 369.99, 440, 587.33][i] || 440;
                tone(base, 0.075, 'triangle', 0.044, 0, 0.006);
                tone(base * 2, 0.10, 'sine', 0.026, 0.035, 0.008);
                noise(0.014, 0.026, 0, 5600);
            },
            introTitle() {
                tone(174.61, 0.38, 'sine', 0.06, 0, 0.02);
                tone(349.23, 0.44, 'triangle', 0.055, 0.05, 0.02);
                tone(523.25, 0.54, 'sine', 0.046, 0.12, 0.02);
                tone(698.46, 0.36, 'sine', 0.025, 0.22, 0.02);
                sweep(1000, 2800, 0.52, 'sine', 0.024, 0.08);
            },
            introBloom() {
                tone(130.81, 0.56, 'sine', 0.078, 0, 0.02);
                tone(261.63, 0.50, 'triangle', 0.052, 0.04, 0.02);
                tone(392, 0.48, 'sine', 0.035, 0.10, 0.02);
                tone(783.99, 0.34, 'sine', 0.022, 0.18, 0.02);
                noise(0.13, 0.034, 0.04, 6800);
                sweep(1600, 3400, 0.34, 'sine', 0.020, 0.18);
            },
            bootDrone() {
                return this.introBed();
            },
            stopDrone(d) {
                if (!d || !ctx) return;
                const t = ctx.currentTime;
                const gainNode = d._g || d.g;
                if (gainNode) {
                    gainNode.gain.cancelScheduledValues(t);
                    gainNode.gain.setValueAtTime(Math.max(gainNode.gain.value, 0.0001), t);
                    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
                }
                setTimeout(() => { (d._oscs || [d.osc, d.lfo]).forEach(o => { try { o.stop(); } catch(e) {} }); }, 850);
            },
            bootBeamLock(i) { this.introStep(i % 4); },
            bootChargeStart() {
                sweep(180, 1200, 1.8, 'sine', 0.06);
                tone(65, 1.4, 'sine', 0.06, 0.1);
            },
            bootOverload() {
                this.introBloom();
            },
            bootTitleReveal() {
                this.introTitle();
            },
            bootComplete() {
                this.introBloom();
            }
        };
    })();
