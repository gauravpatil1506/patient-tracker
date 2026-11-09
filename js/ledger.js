/**
 * Ledger & Financial Operations
 * Handles pending balances, collected revenue, WhatsApp reminders, and delete management
 */

window.PhysioLedger = (function() {
  let currentView = 'pending'; // 'pending' | 'received'
  let currentFilter = '';
  let olderLoadedCount = 0;
  let deleteMode = false;
  let cachedPendingListForWA = [];

  function switchLedgerView(view) {
    currentView = view;
    const btnPending = document.getElementById('btnTogglePending');
    const btnReceived = document.getElementById('btnToggleReceived');
    const pendingList = document.getElementById('pendingList');
    const receivedList = document.getElementById('receivedList');

    if (view === 'pending') {
      btnPending.classList.add('active-pending');
      btnReceived.classList.remove('active-received');
      pendingList.style.display = 'block';
      receivedList.style.display = 'none';
    } else {
      btnReceived.classList.add('active-received');
      btnPending.classList.remove('active-pending');
      pendingList.style.display = 'none';
      receivedList.style.display = 'block';
    }

    renderLedger();
  }

  function renderLedger() {
    const visits = PhysioDB.getVisits();
    const filterName = document.getElementById('ledgerPatientSelect').value;
    const summaryBadge = document.getElementById('ledgerSummary');
    const waButton = document.getElementById('waReminderBtn');
    const groupedBar = document.getElementById('groupedActionBar');
    const groupedQrBtn = document.getElementById('groupedQrBtn');

    if (filterName !== currentFilter) {
      currentFilter = filterName;
      olderLoadedCount = 0;
    }

    let pendingHTML = '';
    let foundPending = false;
    let pendingCount = 0;
    let pendingTotal = 0;
    let receivedRecords = [];
    cachedPendingListForWA = [];

    visits.forEach(v => {
      const d = v.date ? new Date(v.date) : null;
      if (!d || isNaN(d)) return;

      const displayDate = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const waDateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
      const pType = (v.paymentType || '').toLowerCase().trim();
      const amountPaid = parseFloat(v.amountPaid) || 0;
      const totalFee = parseFloat(v.totalFee) || 0;

      if (filterName && v.name !== filterName) return;

      // Pending condition
      if (pType === 'pending' || ((pType === 'cash' || pType === 'online') && amountPaid < totalFee)) {
        foundPending = true;
        const balance = totalFee - amountPaid;
        pendingCount++;
        pendingTotal += balance;
        cachedPendingListForWA.push({ date: waDateStr, amount: balance });

        pendingHTML += `
        <div class="card" style="border-left: 4px solid var(--danger); padding: 14px 16px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1; padding-right: 8px;">
              <h4 style="margin: 0 0 4px 0; font-size: 16px; color: var(--text-main);">${v.name}</h4>
              <div style="font-size: 12px; color: var(--text-muted);">${displayDate} (${v.sessionType || 'Session'})</div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="color: var(--danger); font-weight: 800; font-size: 16px;">₹${balance.toLocaleString('en-IN')}</div>
              <div style="display: flex; gap: 6px;">
                <button class="btn-main" style="margin:0; width: 36px; height: 36px; padding: 0; font-size: 14px; background: #2563eb; border-radius: var(--radius-sm);" onclick="PhysioPayments.showQRModal('${v.name.replace(/'/g, "\\'")}', 'Session: ${displayDate}', ${balance}, 'Physio - ${v.name.replace(/'/g, "\\'")}')" title="Scan UPI QR">📷</button>
                <button class="btn-main" style="margin:0; width: 36px; height: 36px; padding: 0; font-size: 14px; background: var(--success); border-radius: var(--radius-sm);" onclick="PhysioLedger.settlePayment(${v.id}, 'Cash', ${totalFee})" title="Mark Paid via Cash">💵</button>
                <button class="btn-main" style="margin:0; width: 36px; height: 36px; padding: 0; font-size: 14px; background: #0284c7; border-radius: var(--radius-sm);" onclick="PhysioLedger.settlePayment(${v.id}, 'Online', ${totalFee})" title="Mark Paid via UPI">📱</button>
              </div>
            </div>
          </div>
        </div>`;
      }

      if (amountPaid > 0) {
        receivedRecords.push({
          id: v.id,
          name: v.name,
          dateObj: d,
          displayDate: displayDate,
          amount: amountPaid,
          method: v.paymentType || "Online"
        });
      }
    });

    const pendingListDiv = document.getElementById('pendingList');
    if (!foundPending) {
      if (filterName) {
        pendingListDiv.innerHTML = `<div class="card" style="text-align:center;"><p>🎉 <strong>${filterName}</strong> has zero pending dues!</p></div>`;
      } else {
        pendingListDiv.innerHTML = '<div class="card" style="text-align:center;"><p>🎉 Zero pending dues across all clinic patients!</p></div>';
      }
      if (groupedBar) groupedBar.style.display = "none";
    } else {
      pendingListDiv.innerHTML = pendingHTML;
    }

    // Render Received Payments
    const receivedListDiv = document.getElementById('receivedList');
    if (receivedRecords.length === 0) {
      receivedListDiv.innerHTML = '<div class="card" style="text-align:center;"><p>No received payments recorded.</p></div>';
    } else {
      receivedRecords.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());

      let displayCount = 20 + (olderLoadedCount * 25);
      let toShow = receivedRecords.slice(0, displayCount);
      let remaining = Math.max(0, receivedRecords.length - displayCount);

      let receivedHTML = '';
      toShow.forEach(r => {
        receivedHTML += `
        <div class="card" style="border-left: 4px solid var(--success); padding: 12px 16px; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h4 style="margin: 0 0 2px 0; font-size: 15px; color: var(--text-main);">${r.name}</h4>
              <div style="font-size: 12px; color: var(--text-muted);">${r.displayDate}</div>
            </div>
            <div style="text-align: right;">
              <div style="color: var(--success); font-weight: 800; font-size: 16px;">+ ₹${r.amount.toLocaleString('en-IN')}</div>
              <div style="font-size: 11px; color: var(--text-muted); font-weight: 600;">✓ ${r.method}</div>
            </div>
          </div>
        </div>`;
      });

      if (remaining > 0) {
        receivedHTML += `<button class="btn-main btn-secondary" onclick="PhysioLedger.loadMoreReceived()" style="margin-bottom: 20px;">Load Older Payments (${remaining} remaining)</button>`;
      }
      receivedListDiv.innerHTML = receivedHTML;
    }

    // Update Header Summary and Grouped Action Bar
    if (filterName && foundPending && currentView === 'pending') {
      summaryBadge.innerText = `${pendingCount} | ₹${pendingTotal.toLocaleString('en-IN')}`;
      summaryBadge.style.display = "block";
      waButton.style.display = "flex";
      groupedBar.style.display = "block";

      groupedQrBtn.innerText = `📷 Show Combined UPI QR (₹${pendingTotal.toLocaleString('en-IN')})`;
      groupedQrBtn.onclick = function() {
        PhysioPayments.showQRModal(filterName, `Combined (${pendingCount} Sessions)`, pendingTotal, `Physio - ${filterName}`);
      };
    } else {
      summaryBadge.style.display = "none";
      waButton.style.display = "none";
      groupedBar.style.display = "none";
    }
  }

  function loadMoreReceived() {
    olderLoadedCount++;
    renderLedger();
  }

  async function settlePayment(visitId, method, totalFee) {
    if (!confirm(`Confirm clearing balance of ₹${totalFee.toLocaleString('en-IN')} via ${method}?`)) return;
    await PhysioDB.updatePayment(visitId, method, totalFee);
    PhysioApp.showToast(`✓ Marked as paid via ${method}`, "success");
    renderLedger();
  }

  function dispatchWhatsAppReminder() {
    const filterName = document.getElementById('ledgerPatientSelect').value;
    if (!filterName || cachedPendingListForWA.length === 0) return;

    const phones = PhysioDB.getPatientPhones();
    const phone = phones[PhysioDB.sanitizeName(filterName)];
    PhysioPayments.sendWhatsAppInvoice(filterName, cachedPendingListForWA, phone);
  }

  // Tab 2: Recent & Upcoming Appointments
  function renderRecentAndUpcoming() {
    const upcomingDiv = document.getElementById('upcomingList');
    const recentDiv = document.getElementById('recentList');
    const btnEditRecent = document.getElementById('btnEditRecent');
    if (!upcomingDiv || !recentDiv) return;

    const visits = PhysioDB.getVisits();
    if (visits.length === 0) {
      upcomingDiv.innerHTML = '<div class="card" style="text-align:center;"><p>No visits recorded yet.</p></div>';
      recentDiv.innerHTML = '';
      if (btnEditRecent) btnEditRecent.style.display = 'none';
      return;
    }

    if (btnEditRecent) btnEditRecent.style.display = 'block';

    // Upcoming logic: latest appointment per patient >= today
    let latestMap = new Map();
    visits.forEach(v => {
      const name = v.name;
      const vTime = v.date ? new Date(v.date).getTime() : 0;
      if (!latestMap.has(name) || vTime > (latestMap.get(name).date ? new Date(latestMap.get(name).date).getTime() : 0)) {
        latestMap.set(name, v);
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let upcoming = [];
    latestMap.forEach(v => {
      if (v.nextAppt) {
        const apptDate = new Date(v.nextAppt);
        if (!isNaN(apptDate) && apptDate >= today) {
          upcoming.push({ name: v.name, date: apptDate, visit: v });
        }
      }
    });

    upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());

    if (upcoming.length === 0) {
      upcomingDiv.innerHTML = '<div class="card" style="text-align:center;"><p style="color:var(--text-muted);">No upcoming appointments scheduled.</p></div>';
    } else {
      let upHtml = '';
      const phones = PhysioDB.getPatientPhones();

      upcoming.forEach(item => {
        const d = item.date;
        const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', weekday: 'short' });
        const phone = phones[PhysioDB.sanitizeName(item.name)];

        upHtml += `
        <div class="card" style="border-left: 4px solid var(--whatsapp); display: flex; justify-content: space-between; align-items: center; padding: 14px;">
          <div>
            <h4 style="margin: 0 0 4px 0; color: var(--primary); font-size: 16px;">${item.name}</h4>
            <span style="font-size: 13px; font-weight: 700; color: var(--text-main);">${dateStr}</span>
          </div>
          <button class="wa-btn" onclick="PhysioPayments.sendAppointmentReminder('${item.name.replace(/'/g, "\\'")}', '${dateStr}', '${phone || ''}')" title="Send WhatsApp Appointment Reminder">
            <svg viewBox="0 0 24 24"><path d="M12.031 0C5.385 0 0 5.388 0 12.042c0 2.128.552 4.195 1.6 6.007L.182 24l6.103-1.602a11.967 11.967 0 0 0 5.746 1.472h.005c6.645 0 12.03-5.387 12.03-12.04C24.066 5.385 18.679 0 12.031 0zm0 21.916a9.927 9.927 0 0 1-5.077-1.39l-.364-.216-3.774.99.999-3.681-.237-.377a9.914 9.914 0 0 1-1.523-5.2C2.054 5.518 7.558 0 14.167 0c6.608 0 12.016 5.517 12.016 12.042 0 6.526-5.408 12.042-12.016 12.042zm6.59-8.995c-.361-.182-2.143-1.058-2.474-1.18-.332-.12-5.74-.182-.812.09l-1.168 1.39c-.276.332-.553.364-.915.183-.362-.182-1.529-.564-2.913-1.802-1.077-.962-1.804-2.15-2.014-2.512-.21-.362-.022-.558.158-.738.163-.162.362-.423.543-.634.181-.212.241-.362.362-.603.12-.24.06-.453-.03-.634-.09-.182-.813-1.958-1.114-2.68-.293-.7-.594-.606-.813-.617-.211-.01-.452-.01-.693-.01-.24 0-.632.09-.963.452-.332.363-1.265 1.239-1.265 3.02s1.295 3.504 1.476 3.746c.181.242 2.551 3.896 6.182 5.462.864.373 1.54.596 2.066.763.868.275 1.658.236 2.279.143.697-.104 2.143-.876 2.443-1.722.302-.846.302-1.57.211-1.722-.09-.15-.332-.24-.693-.42z"/></svg>
          </button>
        </div>`;
      });
      upcomingDiv.innerHTML = upHtml;
    }

    // Last 5 Sessions
    const sortedVisits = [...visits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const top5 = sortedVisits.slice(0, 5);

    let recentHTML = '';
    const displayStyle = deleteMode ? 'block' : 'none';

    top5.forEach(v => {
      const d = v.date ? new Date(v.date) : null;
      const dateStr = d && !isNaN(d) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : "No Date";

      recentHTML += `
      <div class="card" style="border-left: 4px solid var(--secondary); display: flex; justify-content: space-between; align-items: center; padding: 14px; position: relative;">
        <div>
          <h4 style="margin: 0 0 4px 0; color: var(--text-main); font-size: 16px;">${v.name}</h4>
          <span style="font-size: 12px; color: var(--text-muted);">${v.location || "Clinic"} • ${v.sessionType || "Regular"}</span>
        </div>
        <div style="font-weight: 700; color: var(--primary); font-size: 13px; text-align: right;">${dateStr}</div>
        
        <button class="delete-btn" style="display: ${displayStyle}; position: absolute; top: -10px; right: -10px; background: var(--danger); color: white; border: none; border-radius: 50%; width: 28px; height: 28px; font-size: 12px; cursor: pointer; box-shadow: var(--shadow-md);" onclick="PhysioLedger.handleDeleteVisit(${v.id})">🗑️</button>
      </div>`;
    });

    recentDiv.innerHTML = recentHTML;
  }

  function toggleDeleteMode() {
    deleteMode = !deleteMode;
    const btn = document.getElementById('btnEditRecent');
    if (btn) btn.innerText = deleteMode ? '❌' : '✏️';
    document.querySelectorAll('.delete-btn').forEach(b => b.style.display = deleteMode ? 'block' : 'none');
  }

  async function handleDeleteVisit(visitId) {
    if (!confirm("Are you sure you want to permanently delete this visit? This cannot be undone.")) return;
    await PhysioDB.deleteVisit(visitId);
    PhysioApp.showToast("✓ Record deleted", "info");
    deleteMode = false;
    const btn = document.getElementById('btnEditRecent');
    if (btn) btn.innerText = '✏️';
    renderRecentAndUpcoming();
  }

  return {
    switchLedgerView,
    renderLedger,
    loadMoreReceived,
    settlePayment,
    dispatchWhatsAppReminder,
    renderRecentAndUpcoming,
    toggleDeleteMode,
    handleDeleteVisit
  };
})();
