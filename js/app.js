/**
 * Master Application Orchestrator
 * Routing, Lifecycle, Service Worker Registration, Toast Notifications, and Firebase Migration UI
 */

window.PhysioApp = (function() {
  let currentModalContext = '';
  let globalPatients = [];

  // Bootstrapping
  async function init() {
    initTheme();
    registerServiceWorker();

    // Check if URL is in Patient Invoice Viewer mode
    const urlParams = new URLSearchParams(window.location.search);
    const invoiceToken = urlParams.get('invoice');
    if (invoiceToken) {
      renderStandaloneInvoiceMode(invoiceToken);
      return;
    }

    // Doctor Clinic Mode: Initialize IndexedDB
    updateSyncIndicator("syncing");
    const visits = await PhysioDB.init();
    updateGlobalPatientsList(visits);

    // Initial render active tab instantly
    PhysioClinical.initPainSelectors();
    PhysioClinical.renderQuickPatientsBar();
    renderCurrentTab('tab1');
    document.getElementById('date').valueAsDate = new Date();

    // Populate Settings modal status
    updateSettingsModalBackendInfo();

    // Subscribe to DB mutations
    PhysioDB.subscribe(updatedVisits => {
      updateGlobalPatientsList(updatedVisits);
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab) renderCurrentTab(activeTab.id);
    });

    // Background sync with cloud
    PhysioDB.syncWithCloud(status => {
      updateSyncIndicator(status);
    });

    // Network listeners
    window.addEventListener('online', () => {
      updateSyncIndicator("syncing");
      PhysioDB.syncWithCloud(status => updateSyncIndicator(status));
    });

    window.addEventListener('offline', () => {
      updateSyncIndicator("offline");
      showToast("Operating Offline - Changes saved locally", "info");
    });
  }

  // Register Service Worker
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
          console.warn('SW registration failed:', err);
        });
      });
    }
  }

  // Theme Management
  function initTheme() {
    const saved = localStorage.getItem(PhysioConfig.STORAGE_KEYS.THEME) || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
  }

  function toggleTheme() {
    const curr = document.documentElement.getAttribute('data-theme') || 'light';
    const next = curr === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(PhysioConfig.STORAGE_KEYS.THEME, next);
    updateThemeIcon(next);
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab && activeTab.id === 'tab5') {
      PhysioAnalytics.renderDashboard();
    }
  }

  function updateThemeIcon(theme) {
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerText = theme === 'dark' ? '☀️' : '🌙';
  }

  // Sync Indicator
  function updateSyncIndicator(status) {
    const pill = document.getElementById('syncIndicator');
    if (!pill) return;

    const backend = PhysioDB.getActiveBackend();
    const badgeLabel = backend === 'firebase' ? 'Firestore' : 'Sheets';

    if (status === 'syncing') {
      pill.className = 'sync-pill syncing';
      pill.innerHTML = `<svg class="spinner" viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg> ${badgeLabel}`;
    } else if (status === 'offline') {
      pill.className = 'sync-pill offline';
      pill.innerText = '⚠️ Offline';
    } else {
      pill.className = 'sync-pill';
      pill.innerText = `✓ ${badgeLabel}`;
      setTimeout(() => {
        if (pill.innerText === `✓ ${badgeLabel}`) pill.innerText = '';
      }, 3000);
    }
  }

  // Toast Notifications
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  // Tab Switching
  function switchTab(tabId) {
    window.scrollTo(0, 0);
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));

    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add('active');

    const targetNav = document.getElementById('nav-' + tabId);
    if (targetNav) targetNav.classList.add('active');

    renderCurrentTab(tabId);
  }

  function renderCurrentTab(tabId) {
    if (tabId === 'tab1') PhysioClinical.renderQuickPatientsBar();
    if (tabId === 'tab2') PhysioLedger.renderRecentAndUpcoming();
    if (tabId === 'tab3') PhysioLedger.renderLedger();
    if (tabId === 'tab4') PhysioClinical.renderPatientHistory();
    if (tabId === 'tab5') {
      PhysioAnalytics.renderDashboard();
      PhysioAnalytics.renderPatientAnalytics();
    }
  }

  function updateGlobalPatientsList(visits) {
    const names = new Set();
    visits.forEach(v => {
      if (v.name) names.add(PhysioDB.sanitizeName(v.name));
    });
    globalPatients = Array.from(names).sort();
  }

  // Slide-Up Bottom Sheet Patient Search Drawer
  function openPatientModal(contextTabId) {
    currentModalContext = contextTabId;
    const modal = document.getElementById('patientSearchModal');
    if (!modal) return;

    modal.style.display = 'flex';
    const input = document.getElementById('modalSearchInput');
    input.value = '';
    renderModalList('');
    setTimeout(() => input.focus(), 80);
  }

  function closePatientModal() {
    const modal = document.getElementById('patientSearchModal');
    if (modal) modal.style.display = 'none';
  }

  function renderModalList(query) {
    const list = document.getElementById('modalPatientList');
    if (!list) return;

    const safeQ = PhysioDB.sanitizeName(query);
    const filtered = globalPatients.filter(n => n.toLowerCase().includes(safeQ.toLowerCase()));

    let html = '';
    if (currentModalContext === 'tab3') {
      html += `<div class="sheet-item" onclick="PhysioApp.selectFromModal('All Patients')"><strong>📋 Show All Patients</strong></div>`;
    }

    if (currentModalContext === 'tab1' && safeQ) {
      const exact = filtered.find(n => n.toLowerCase() === safeQ.toLowerCase());
      if (!exact) {
        html += `<div class="sheet-item add-new" onclick="PhysioApp.selectFromModal('${safeQ.replace(/'/g, "\\'")}')">+ Add "${safeQ}" as New Patient</div>`;
      }
    }

    filtered.forEach(name => {
      html += `<div class="sheet-item" onclick="PhysioApp.selectFromModal('${name.replace(/'/g, "\\'")}')">${name}</div>`;
    });

    if (filtered.length === 0 && !safeQ && currentModalContext !== 'tab3') {
      html += `<div class="sheet-item" style="color:var(--text-muted); justify-content:center;">Type to search patient name...</div>`;
    }

    list.innerHTML = html;
  }

  function selectFromModal(selectedName) {
    closePatientModal();

    if (currentModalContext === 'tab1') {
      document.getElementById('name').value = selectedName;
      document.getElementById('btnTab1Patient').innerHTML = `<strong>${selectedName}</strong>`;
      PhysioClinical.quickSelectPatient(selectedName);

      const phones = PhysioDB.getPatientPhones();
      const pField = document.getElementById('patientPhone');
      if (pField) pField.value = phones[PhysioDB.sanitizeName(selectedName)] || '';
    } else if (currentModalContext === 'tab3') {
      const val = selectedName === 'All Patients' ? '' : selectedName;
      document.getElementById('ledgerPatientSelect').value = val;
      document.getElementById('btnTab3Patient').innerHTML = val ? `<strong>${val}</strong>` : '📋 All Patients';
      PhysioLedger.renderLedger();
    } else if (currentModalContext === 'tab4') {
      document.getElementById('patientSelect').value = selectedName;
      document.getElementById('btnTab4Patient').innerHTML = `<strong>${selectedName}</strong>`;
      PhysioClinical.renderPatientHistory();
    } else if (currentModalContext === 'tab5') {
      document.getElementById('analyticsPatientSelect').value = selectedName;
      document.getElementById('btnTab5Patient').innerHTML = `<strong>${selectedName}</strong>`;
      PhysioAnalytics.renderPatientAnalytics();
    }
  }

  // Backup & Settings Modal
  function openSettingsModal() {
    updateSettingsModalBackendInfo();
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'flex';
  }

  function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
  }

  function updateSettingsModalBackendInfo() {
    const statusText = document.getElementById('backendStatusBadge');
    if (!statusText) return;

    const backend = PhysioDB.getActiveBackend();
    if (backend === 'firebase') {
      statusText.innerHTML = '<span style="color:var(--success); font-weight:700;">🔥 Firebase Firestore Active</span>';
    } else {
      statusText.innerHTML = '<span style="color:var(--primary); font-weight:700;">🟢 Google Sheets ("Physio Tracker") Active</span>';
    }

    const cfg = PhysioDB.getFirebaseConfig();
    const configInput = document.getElementById('firebaseConfigInput');
    if (configInput && cfg) {
      configInput.value = JSON.stringify(cfg, null, 2);
    }
  }

  async function handleSaveFirebaseConfig() {
    const raw = (document.getElementById('firebaseConfigInput').value || '').trim();
    if (!raw) {
      showToast("Please paste your Firebase Config JSON", "error");
      return;
    }

    try {
      let cfg;
      if (raw.startsWith('{')) {
        cfg = JSON.parse(raw);
      } else {
        // Extract json object if user pasted const firebaseConfig = { ... };
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) cfg = JSON.parse(match[0]);
        else throw new Error("Invalid config format");
      }

      localStorage.setItem(PhysioConfig.STORAGE_KEYS.FIREBASE_CONFIG, JSON.stringify(cfg));
      const ok = PhysioDB.initFirebase(cfg);
      if (ok) {
        showToast("✓ Firebase Config saved & initialized!", "success");
        updateSettingsModalBackendInfo();
      } else {
        showToast("Firebase init error. Check projectId.", "error");
      }
    } catch (e) {
      showToast("Invalid JSON config format", "error");
    }
  }

  async function handleStartFirebaseMigration() {
    const btn = document.getElementById('btnStartMigration');
    btn.disabled = true;
    btn.innerText = "Migrating to Firestore...";

    try {
      const res = await PhysioDB.migrateAllToFirebase((done, total) => {
        btn.innerText = `Migrating ${done}/${total}...`;
      });

      showToast(`🎉 Migrated ${res.migratedVisits} visits & ${res.migratedPatients} patients!`, "success");
      updateSettingsModalBackendInfo();
      updateSyncIndicator("success");
    } catch (err) {
      showToast(err.message || "Migration failed", "error");
    } finally {
      btn.disabled = false;
      btn.innerText = "🔥 Migrate All 288 Records to Firebase Firestore";
    }
  }

  function handleSwitchBackend(type) {
    PhysioDB.setActiveBackend(type);
    updateSettingsModalBackendInfo();
    updateSyncIndicator("success");
    showToast(`Switched active cloud backend to ${type.toUpperCase()}`, "info");
  }

  // ========================================================
  // STANDALONE INVOICE PORTAL FOR PATIENTS
  // ========================================================
  async function renderStandaloneInvoiceMode(token) {
    const patientName = PhysioPayments.decodePatientToken(token);
    document.getElementById('doctorAppView').style.display = 'none';

    const portalMount = document.getElementById('patientInvoiceMount');
    portalMount.style.display = 'flex';

    if (!patientName) {
      portalMount.innerHTML = `
      <div class="invoice-card">
        <div style="font-size:3rem; margin-bottom:10px;">❌</div>
        <h2 style="color:var(--danger); margin:0 0 8px 0;">Invoice Not Found</h2>
        <p style="color:var(--text-muted);">The payment link is invalid or expired. Please contact ${PhysioConfig.CLINIC_NAME}.</p>
      </div>`;
      return;
    }

    const visits = await PhysioDB.init();
    const cleanName = PhysioDB.sanitizeName(patientName);
    const patientVisits = visits.filter(v => v.name === cleanName);

    let pendingSessions = [];
    let totalDue = 0;

    patientVisits.forEach(v => {
      const pType = (v.paymentType || '').toLowerCase().trim();
      const fee = parseFloat(v.totalFee) || 0;
      const paid = parseFloat(v.amountPaid) || 0;
      if (pType === 'pending' || ((pType === 'cash' || pType === 'online') && paid < fee)) {
        const bal = fee - paid;
        totalDue += bal;
        const d = v.date ? new Date(v.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : "Visit";
        pendingSessions.push({ date: d, amount: bal, session: v.sessionType || "Session" });
      }
    });

    if (totalDue === 0) {
      portalMount.innerHTML = `
      <div class="invoice-card">
        <div style="font-size:3rem; margin-bottom:10px;">✅</div>
        <h2 style="color:var(--success); margin:0 0 8px 0;">All Dues Cleared</h2>
        <p style="color:var(--text-main); font-size:15px;">Hello <strong>${cleanName}</strong>, you have zero outstanding balances with ${PhysioConfig.CLINIC_NAME}. Thank you!</p>
      </div>`;
      return;
    }

    let itemsHtml = '';
    pendingSessions.forEach(item => {
      itemsHtml += `
      <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border-subtle); font-size:14px;">
        <span>${item.date} (${item.session})</span>
        <strong style="color:var(--text-main);">${PhysioPayments.formatINR(item.amount)}</strong>
      </div>`;
    });

    const upiLink = PhysioPayments.buildUPIString(PhysioConfig.CLINIC_UPI_ID, PhysioConfig.CLINIC_PAYEE_NAME, totalDue, `Physio Fee - ${cleanName}`);

    portalMount.innerHTML = `
    <div class="invoice-card">
      <div style="font-size: 13px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--primary); margin-bottom:4px;">${PhysioConfig.CLINIC_NAME}</div>
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:18px;">${PhysioConfig.CLINIC_TITLE}</div>
      
      <div class="invoice-badge-due">
        <div style="font-size:12px; font-weight:700; color:var(--success-text); text-transform:uppercase;">Total Outstanding Due</div>
        <div style="font-size:2.2rem; font-weight:800; color:var(--success-text); margin-top:4px;">${PhysioPayments.formatINR(totalDue)}</div>
        <div style="font-size:13px; color:var(--text-muted); margin-top:2px;">Patient: <strong>${cleanName}</strong></div>
      </div>

      <div style="text-align:left; background:var(--bg-input); border-radius:var(--radius-md); padding:14px; margin-bottom:20px; border:1px solid var(--border-subtle);">
        <strong style="font-size:13px; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:8px;">Session Breakdown:</strong>
        ${itemsHtml}
      </div>

      <a href="${upiLink}" class="btn-main" style="background:var(--primary); text-decoration:none; padding:16px; font-size:17px; margin-bottom:16px;">
        ⚡ Pay ${PhysioPayments.formatINR(totalDue)} via UPI
      </a>

      <div style="margin-top:10px;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">Or scan using any UPI App (GPay, PhonePe, Paytm):</div>
        <div id="patientQrCanvasContainer" style="background:#fff; padding:12px; border-radius:var(--radius-md); display:inline-block; border:1px solid var(--border-subtle);"></div>
      </div>

      <button class="btn-main btn-secondary" style="margin-top:16px; padding:10px;" onclick="PhysioApp.copyUPI()">
        📋 Copy UPI ID: ${PhysioConfig.CLINIC_UPI_ID}
      </button>

      <div style="margin-top:20px; font-size:11px; color:var(--text-light);">
        Secured UPI Peer-to-Peer Transfer • Bank Grade Security
      </div>
    </div>`;

    setTimeout(() => {
      const qrBox = document.getElementById('patientQrCanvasContainer');
      if (qrBox && window.QRCode) {
        new QRCode(qrBox, {
          text: upiLink,
          width: 170,
          height: 170,
          colorDark: "#004d40",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.H
        });
      }
    }, 50);
  }

  function copyUPI() {
    navigator.clipboard.writeText(PhysioConfig.CLINIC_UPI_ID).then(() => {
      showToast("✓ UPI ID copied to clipboard!", "success");
    }).catch(() => {
      showToast("UPI ID: " + PhysioConfig.CLINIC_UPI_ID, "info");
    });
  }

  return {
    init,
    toggleTheme,
    switchTab,
    showToast,
    openPatientModal,
    closePatientModal,
    renderModalList,
    selectFromModal,
    openSettingsModal,
    closeSettingsModal,
    copyUPI,
    handleSaveFirebaseConfig,
    handleStartFirebaseMigration,
    handleSwitchBackend
  };
})();

window.addEventListener('DOMContentLoaded', PhysioApp.init);
