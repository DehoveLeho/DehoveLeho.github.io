/**
 * Portfolio Telemetry & Visitor Activity Tracker
 * Formatted for instant Arrival & Exit email reports via FormSubmit.co
 */
(function () {
  'use strict';

  // --- 1. Anti-Self-Tracking & Exclusion Check ---
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('me') || urlParams.has('admin') || urlParams.has('no_track')) {
    localStorage.setItem('leho_no_track', '1');
    console.info('[Telemetry] Mode développeur activé : vos visites personnelles ne seront pas tracées.');
    return;
  }
  if (urlParams.has('track_me') || urlParams.has('enable_track')) {
    localStorage.removeItem('leho_no_track');
    console.info('[Telemetry] Suivi réactivé.');
  }
  if (localStorage.getItem('leho_no_track') === '1' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return;
  }

  const ENDPOINT = 'https://formsubmit.co/ajax/lehodehove@gmail.com';
  const startTime = Date.now();
  const sessionId = 'sess_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);

  let geoData = {
    ip: 'En cours...',
    city: 'Inconnue',
    region: '',
    country: 'Inconnu',
    org: 'Fournisseur inconnu',
    postal: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Inconnu'
  };

  let maxScrollPercent = 0;
  let cvDownloaded = false;
  let cvDownloadCount = 0;
  let portfolioPdfDownloaded = false;
  let turtleInteractions = 0;
  let exitPingSent = false;
  const clickedLinks = [];
  const copiedTexts = [];

  // Dwell time per section
  const sectionDwell = {
    'Hero (Accueil & Tortues)': 0,
    'About (Parcours & Bio)': 0,
    'Projects (KiAnSo, OptoStim...)': 0,
    'CAD Models': 0,
    'Experiments (PID, Coin-Toss)': 0,
    'Contact': 0
  };
  let activeSection = 'Hero (Accueil & Tortues)';
  let lastSectionSwitch = Date.now();

  function switchActiveSection(newSection) {
    if (activeSection === newSection) return;
    const now = Date.now();
    const elapsed = Math.round((now - lastSectionSwitch) / 1000);
    if (elapsed > 0 && sectionDwell[activeSection] !== undefined) {
      sectionDwell[activeSection] += elapsed;
    }
    activeSection = newSection;
    lastSectionSwitch = now;
  }

  function flushCurrentSection() {
    const now = Date.now();
    const elapsed = Math.round((now - lastSectionSwitch) / 1000);
    if (elapsed > 0 && sectionDwell[activeSection] !== undefined) {
      sectionDwell[activeSection] += elapsed;
    }
    lastSectionSwitch = now;
  }

  // --- 2. Client Hardware & Browser Detection ---
  function getClientInfo() {
    const ua = navigator.userAgent || '';
    let os = 'Inconnu';
    if (/Windows NT 10.0/.test(ua)) os = 'Windows 10/11';
    else if (/Windows NT/.test(ua)) os = 'Windows';
    else if (/Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) os = 'macOS';
    else if (/iPhone/.test(ua)) os = 'iOS (iPhone)';
    else if (/iPad/.test(ua)) os = 'iPadOS (iPad)';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/Linux/.test(ua)) os = 'Linux';

    let browser = 'Inconnu';
    if (/Brave/i.test(navigator.brave ? 'Brave' : '')) browser = 'Brave';
    else if (/Edg\//.test(ua)) browser = 'Microsoft Edge';
    else if (/Chrome\//.test(ua) && !/Chromium|OPR/.test(ua)) browser = 'Google Chrome';
    else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Apple Safari';
    else if (/Firefox\//.test(ua)) browser = 'Mozilla Firefox';
    else if (/OPR\//.test(ua)) browser = 'Opera';

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
    const isTablet = /iPad|Tablet/i.test(ua) || (isMobile && screen.width >= 768);
    const deviceType = isTablet ? 'Tablette' : isMobile ? 'Mobile' : 'Ordinateur (Desktop)';

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const connectionInfo = conn ? `${conn.effectiveType || 'N/A'} (débit: ~${conn.downlink || '?'} Mbps)` : 'N/A';

    return {
      os,
      browser,
      deviceType,
      screenRes: `${screen.width}x${screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      pixelRatio: window.devicePixelRatio || 1,
      language: navigator.languages ? navigator.languages.join(', ') : (navigator.language || 'N/A'),
      cpuCores: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} cœurs` : 'N/A',
      deviceMemory: navigator.deviceMemory ? `~${navigator.deviceMemory} Go RAM` : 'N/A',
      connectionInfo,
      themePref: window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'Mode Sombre (Dark)' : 'Mode Clair (Light)',
      touchSupport: ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? 'Tactile (Touch)' : 'Souris/Trackpad'
    };
  }

  // --- 3. Traffic Origin & Referrer ---
  function getReferrerInfo() {
    const rawRef = document.referrer;
    if (!rawRef) return 'Accès Direct / Favori / Lien PDF du CV';
    try {
      const refUrl = new URL(rawRef);
      if (refUrl.hostname.includes('linkedin.com')) return `LinkedIn (${rawRef})`;
      if (refUrl.hostname.includes('google.')) return `Recherche Google (${rawRef})`;
      if (refUrl.hostname.includes('github.com')) return `GitHub (${rawRef})`;
      return rawRef;
    } catch (e) {
      return rawRef;
    }
  }

  function getUtmInfo() {
    const params = [];
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'].forEach(k => {
      if (urlParams.has(k)) params.push(`${k}=${urlParams.get(k)}`);
    });
    return params.length > 0 ? params.join(' | ') : 'Aucun paramètre de campagne';
  }

  // --- 4. Geo-IP Resolution (ipapi.co with fallback to ipwho.is) ---
  async function resolveGeoIp() {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch('https://ipapi.co/json/', { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const d = await res.json();
        if (d && d.ip) {
          geoData = {
            ip: d.ip || 'N/A',
            city: d.city || 'Ville inconnue',
            region: d.region || '',
            country: d.country_name || d.country || 'Inconnu',
            org: d.org || d.asn || 'Fournisseur inconnu',
            postal: d.postal || '',
            timezone: d.timezone || geoData.timezone
          };
          return;
        }
      }
    } catch (e) {
      // Fallback to ipwho.is
    }

    try {
      const ctrl2 = new AbortController();
      const tid2 = setTimeout(() => ctrl2.abort(), 3000);
      const res2 = await fetch('https://ipwho.is/', { signal: ctrl2.signal });
      clearTimeout(tid2);
      if (res2.ok) {
        const d2 = await res2.json();
        if (d2 && d2.success) {
          geoData = {
            ip: d2.ip || 'N/A',
            city: d2.city || 'Ville inconnue',
            region: d2.region || '',
            country: d2.country || 'Inconnu',
            org: (d2.connection && (d2.connection.org || d2.connection.isp)) || 'Fournisseur inconnu',
            postal: d2.postal || '',
            timezone: (d2.timezone && d2.timezone.id) || geoData.timezone
          };
        }
      }
    } catch (e2) {}
  }

  // --- 5. Activity Event Listeners ---
  function setupTracking() {
    // Scroll depth tracking
    window.addEventListener('scroll', () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight > 0) {
        const currentPercent = Math.min(100, Math.round((window.scrollY / scrollHeight) * 100));
        if (currentPercent > maxScrollPercent) {
          maxScrollPercent = currentPercent;
        }
      }
    }, { passive: true });

    // Section visibility observer
    const sectionMap = [
      { id: 'heroCanvas', name: 'Hero (Accueil & Tortues)' },
      { id: 'about', name: 'About (Parcours & Bio)' },
      { id: 'projects', name: 'Projects (KiAnSo, OptoStim...)' },
      { id: 'cad-models', name: 'CAD Models' },
      { id: 'experiments', name: 'Experiments (PID, Coin-Toss)' },
      { id: 'contact', name: 'Contact' }
    ];

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const found = sectionMap.find(s => s.id === entry.target.id);
            if (found) {
              switchActiveSection(found.name);
            }
          }
        });
      }, { threshold: 0.25 });

      sectionMap.forEach(s => {
        const el = document.getElementById(s.id);
        if (el) observer.observe(el);
      });
    }

    // Click tracking (especially CV downloads)
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a, button');
      if (!a) return;

      const href = a.getAttribute('href') || '';
      const text = (a.innerText || a.getAttribute('aria-label') || a.id || 'Bouton').trim().substring(0, 50);
      const timeOffset = Math.round((Date.now() - startTime) / 1000);

      if (href.includes('Leho_Dehove_CV.pdf') || href.includes('CV.pdf')) {
        cvDownloaded = true;
        cvDownloadCount++;
        clickedLinks.push(`[${timeOffset}s] 🎯 TELECHARGEMENT CV (${href})`);
      } else if (href.includes('Leho_Dehove_Portfolio.pdf')) {
        portfolioPdfDownloaded = true;
        clickedLinks.push(`[${timeOffset}s] 📄 TELECHARGEMENT PORTFOLIO PDF (${href})`);
      } else if (href.includes('linkedin.com')) {
        clickedLinks.push(`[${timeOffset}s] Clic LinkedIn (${href})`);
      } else if (href.includes('github.com')) {
        clickedLinks.push(`[${timeOffset}s] Clic GitHub (${href})`);
      } else if (href.startsWith('mailto:')) {
        clickedLinks.push(`[${timeOffset}s] Clic Email (${href})`);
      } else if (href.startsWith('#')) {
        clickedLinks.push(`[${timeOffset}s] Navigation ancre : ${href} ("${text}")`);
      } else if (href) {
        clickedLinks.push(`[${timeOffset}s] Clic lien externe : ${href} ("${text}")`);
      }
    }, true);

    // Canvas / Turtles interaction
    const heroCanvas = document.getElementById('heroCanvas');
    if (heroCanvas) {
      heroCanvas.addEventListener('pointerdown', () => {
        turtleInteractions++;
      }, { passive: true });
    }

    // Text copy listener
    document.addEventListener('copy', () => {
      const selection = window.getSelection() ? window.getSelection().toString().trim() : '';
      if (selection) {
        const timeOffset = Math.round((Date.now() - startTime) / 1000);
        copiedTexts.push(`[${timeOffset}s] "${selection.substring(0, 100)}"`);
      }
    });
  }

  function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  }

  // --- 6. Send Ping 1: Arrival ---
  async function sendArrivalPing() {
    if (sessionStorage.getItem('telemetry_arrival_sent')) return;
    sessionStorage.setItem('telemetry_arrival_sent', '1');

    const client = getClientInfo();
    const referrer = getReferrerInfo();
    const utm = getUtmInfo();

    const subject = `🟢 [Arrivée Portfolio] ${geoData.city}, ${geoData.country} (${geoData.org}) | Réf: ${referrer.split(' ')[0]}`;

    const payload = {
      _subject: subject,
      _template: 'table',
      _captcha: 'false',
      Statut: 'VISITE EN COURS (Ping d\'arrivée immédiat)',
      Heure_Arrivee: new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) + ' (Heure de Paris)',
      Provenance_Referrer: referrer,
      Campagne_UTM: utm,
      Geolocalisation: `${geoData.city}, ${geoData.region ? geoData.region + ', ' : ''}${geoData.country}${geoData.postal ? ' (' + geoData.postal + ')' : ''}`,
      Entreprise_ou_ISP: geoData.org,
      Adresse_IP: geoData.ip,
      Appareil: client.deviceType,
      Systeme_OS: client.os,
      Navigateur: client.browser,
      Resolution_Ecran: `${client.screenRes} (Fenêtre : ${client.viewport})`,
      Langues_et_Fuseau: `${client.language} | Fuseau: ${geoData.timezone}`,
      Connexion: client.connectionInfo,
      Hardware: `Processeur: ${client.cpuCores} | Mémoire: ${client.deviceMemory}`,
      Page_Entree: window.location.href,
      Session_ID: sessionId
    };

    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      // Non-blocking
    }
  }

  // --- 7. Send Ping 2: Exit (Bilan d'activité complet) ---
  function sendExitPing() {
    if (exitPingSent) return;
    flushCurrentSection();

    const totalSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));
    // Filter out micro-bots staying under 2s without any click or scroll
    if (totalSeconds < 2 && maxScrollPercent < 10 && clickedLinks.length === 0) return;

    exitPingSent = true;

    const client = getClientInfo();
    const referrer = getReferrerInfo();

    let formattedSections = Object.entries(sectionDwell)
      .filter(([_, sec]) => sec > 0)
      .map(([name, sec]) => `${name} : ${formatDuration(sec)}`)
      .join('\n• ');

    if (!formattedSections) formattedSections = 'Visite courte (aucune section maintenue active)';
    else formattedSections = '• ' + formattedSections;

    let clicsFormatted = clickedLinks.length > 0 ? clickedLinks.join('\n') : 'Aucun clic sur lien enregistré';
    let copiesFormatted = copiedTexts.length > 0 ? copiedTexts.join('\n') : 'Aucun texte copié';

    const durationStr = formatDuration(totalSeconds);
    let subject = `🔴 [Bilan Sortie] Visite de ${durationStr} - ${geoData.city}, ${geoData.country} (${geoData.org})`;
    if (cvDownloaded) {
      subject = `🎯 [CV TELECHARGE !] Visite de ${durationStr} - ${geoData.city}, ${geoData.country} (${geoData.org})`;
    }

    const payload = {
      _subject: subject,
      _template: 'table',
      _captcha: 'false',
      Statut: 'VISITE TERMINEE (Bilan Complet d\'Activité)',
      Duree_Totale: `${durationStr} (${totalSeconds} secondes)`,
      CV_Telecharge: cvDownloaded ? `OUI (${cvDownloadCount} fois) 🎯` : 'Non ❌',
      Portfolio_PDF_Telecharge: portfolioPdfDownloaded ? 'OUI 📄' : 'Non',
      Profondeur_Scroll_Max: `${maxScrollPercent}% ${maxScrollPercent >= 85 ? '(A lu toute la page jusqu\'en bas)' : ''}`,
      Temps_Passe_Par_Section: formattedSections,
      Historique_Des_Clics: clicsFormatted,
      Interactions_Tortues_Hero: turtleInteractions > 0 ? `Oui (${turtleInteractions} clics / tracés)` : 'Non',
      Textes_Copies_Par_Visiteur: copiesFormatted,
      Geolocalisation: `${geoData.city}, ${geoData.region ? geoData.region + ', ' : ''}${geoData.country} (${geoData.org})`,
      Adresse_IP: geoData.ip,
      Appareil_et_OS: `${client.deviceType} | ${client.os} | ${client.browser}`,
      Provenance_Referrer: referrer,
      Heure_Sortie: new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) + ' (Heure de Paris)',
      Session_ID: sessionId
    };

    const jsonBlob = new Blob([JSON.stringify(payload)], { type: 'application/json' });

    // Use sendBeacon or fetch with keepalive
    let sent = false;
    if (navigator.sendBeacon) {
      try {
        sent = navigator.sendBeacon(ENDPOINT, jsonBlob);
      } catch (e) {}
    }
    if (!sent && window.fetch) {
      try {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload),
          keepalive: true
        });
      } catch (e) {}
    }
  }

  // --- 8. Lifecycle Orchestration ---
  setupTracking();

  // Resolve GeoIP then fire arrival ping after 1.5s
  resolveGeoIp().finally(() => {
    setTimeout(sendArrivalPing, 1500);
  });

  // Exit handlers (visibilitychange is standard in modern browsers)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      sendExitPing();
    }
  });

  window.addEventListener('pagehide', sendExitPing);
  window.addEventListener('beforeunload', sendExitPing);

})();
