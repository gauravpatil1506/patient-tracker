/**
 * Ledger & Financial Operations
 * Handles pending balances, collected revenue, WhatsApp reminders, and delete management
 * Site-wide multi-row stacked alignment architecture
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

      // Pending condition: unpaid or partially paid
      if (pType === 'pending' || ((pType === 'cash' || pType === 'online') && amountPaid < totalFee)) {
        foundPending = true;
        const balance = totalFee - amountPaid;
        pendingCount++;
        pendingTotal += balance;
        cachedPendingListForWA.push({ date: waDateStr, amount: balance });

        pendingHTML += `
        <div class="card ledger-due-card">
          <!-- Row 1: Patient Name & Outstanding Amount -->
          <div class="card-row-head">
            <h4 class="card-item-title">${v.name}</h4>
            <div class="due-badge-amount">₹${balance.toLocaleString('en-IN')}</div>
          </div>

          <!-- Row 2: Therapy / Session Type on its own dedicated full-width line -->
          <div class="card-row-therapy">
            <span class="therapy-pill">🩺 ${v.sessionType || 'Physiotherapy'}</span>
          </div>

          <!-- Row 3: Meta details with clean | separators -->
          <div class="card-row-meta">
            <span class="meta-item">📅 ${displayDate}</span>
            <span class="meta-sep">|</span>
            <span class="meta-item">📍 ${v.location || 'Clinic'}</span>
            <span class="meta-sep">|</span>
            <span class="meta-item">Fee: ₹${totalFee.toLocaleString('en-IN')}</span>
          </div>

          <!-- Row 4: 1-Tap Action Buttons -->
          <div class="card-row-actions">
            <button class="btn-micro-action btn-action-wa" onclick="PhysioPayments.sendSingleSessionWhatsAppInvoice('${v.name.replace(/'/g, "\\'")}', '${waDateStr}', ${balance}, '${(v.sessionType || 'Session').replace(/'/g, "\\'")}')" title="Send WhatsApp Invoice Link">
              ${PhysioPayments.getWhatsAppIconSVG(16)} <span>WhatsApp</span>
            </button>
            <button class="btn-micro-action btn-action-qr" onclick="PhysioPayments.showQRModal('${v.name.replace(/'/g, "\\'")}', 'Session: ${displayDate}', ${balance}, 'PhysioClinic')" title="Show UPI QR Code">
              📷 <span>QR</span>
            </button>
            <button class="btn-micro-action btn-action-cash" onclick="PhysioLedger.settlePayment(${v.id}, 'Cash', ${totalFee})" title="Mark Received via Cash">
              💵 <span>Cash</span>
            </button>
            <button class="btn-micro-action btn-action-online" onclick="PhysioLedger.settlePayment(${v.id}, 'Online', ${totalFee})" title="Mark Received via Online UPI">
              📱 <span>Online</span>
            </button>
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
          fee: totalFee,
          sessionType: v.sessionType || 'Session',
          location: v.location || 'Clinic',
          method: v.paymentType || 'Paid'
        });
      }
    });

    const pendingListEl = document.getElementById('pendingList');
    if (!foundPending) {
      pendingListEl.innerHTML = `
      <div class="card" style="text-align: center; padding: 28px 16px;">
        <div style="font-size: 2rem; margin-bottom: 8px;">✨</div>
        <p style="color: var(--text-muted); font-size: 14px; margin: 0;">Zero pending dues found ${filterName ? 'for ' + filterName : ''}!</p>
      </div>`;
      summaryBadge.style.display = 'none';
      if (waButton) waButton.style.display = 'none';
      groupedBar.style.display = 'none';
    } else {
      pendingListEl.innerHTML = pendingHTML;
      summaryBadge.innerText = `${pendingCount} Due: ₹${pendingTotal.toLocaleString('en-IN')}`;
      summaryBadge.style.display = 'block';

      if (filterName) {
        if (waButton) {
          waButton.style.display = 'flex';
          waButton.title = `Send Combined WhatsApp Invoice to ${filterName}`;
        }
        groupedBar.style.display = 'block';
        groupedQrBtn.innerText = `📷 Show Combined UPI QR (₹${pendingTotal.toLocaleString('en-IN')})`;
        groupedQrBtn.onclick = () => {
          PhysioPayments.showQRModal(filterName, `${pendingCount} Outstanding Sessions`, pendingTotal, 'PhysioClinic');
        };
      } else {
        if (waButton) waButton.style.display = 'none';
        groupedBar.style.display = 'none';
      }
    }

    // Render Received Records (Stacked row architecture with | separators)
    receivedRecords.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
    const initialLimit = 15;
    const currentLimit = initialLimit + olderLoadedCount;
    const visibleReceived = receivedRecords.slice(0, currentLimit);

    let receivedHTML = '';
    if (visibleReceived.length === 0) {
      receivedHTML = '<div class="card" style="text-align:center; padding: 24px;"><p style="color:var(--text-muted); margin:0;">No payment history recorded.</p></div>';
    } else {
      visibleReceived.forEach(rec => {
        receivedHTML += `
        <div class="card ledger-received-card">
          <!-- Row 1: Patient Name & Amount Received -->
          <div class="card-row-head">
            <h4 class="card-item-title">${rec.name}</h4>
            <div class="received-badge-amount">+₹${rec.amount.toLocaleString('en-IN')}</div>
          </div>

          <!-- Row 2: Therapy Type -->
          <div class="card-row-therapy">
            <span class="therapy-pill">🩺 ${rec.sessionType}</span>
          </div>

          <!-- Row 3: Meta details with | separators -->
          <div class="card-row-meta">
            <span class="meta-item">📅 ${rec.displayDate}</span>
            <span class="meta-sep">|</span>
            <span class="meta-item">Mode: <strong style="color:var(--text-main);">${rec.method}</strong></span>
            <span class="meta-sep">|</span>
            <span class="meta-item">📍 ${rec.location}</span>
          </div>
        </div>`;
      });

      if (receivedRecords.length > currentLimit) {
        receivedHTML += `
        <div style="text-align: center; margin: 16px 0;">
          <button class="btn-main btn-secondary" style="width: auto; padding: 10px 22px; font-size: 13px;" onclick="PhysioLedger.loadMoreReceived()">
            Load Older Payments
          </button>
        </div>`;
      }
    }

    document.getElementById('receivedList').innerHTML = receivedHTML;
  }

  function loadMoreReceived() {
    olderLoadedCount += 15;
    renderLedger();
  }

  // 1-Tap Settle Payment from Tab 3
  async function settlePayment(visitId, paymentMethod, fullAmount) {
    const ok = confirm(`Mark this session as PAID in full (₹${fullAmount}) via ${paymentMethod}?`);
    if (!ok) return;

    try {
      await PhysioDB.updatePayment(visitId, paymentMethod, fullAmount);
      PhysioApp.showToast(`✓ Marked as Paid via ${paymentMethod}`, "success");
      renderLedger();
    } catch (e) {
      PhysioApp.showToast("Error updating payment", "error");
    }
  }

  // Dispatch WhatsApp Invoice (Header button for filtered patient)
  function dispatchWhatsAppReminder() {
    const filterName = document.getElementById('ledgerPatientSelect').value;
    if (!filterName) {
      PhysioApp.showToast("Please filter by a patient first", "info");
      return;
    }
    const phones = PhysioDB.getPatientPhones();
    const phone = phones[PhysioDB.sanitizeName(filterName)];
    PhysioPayments.sendWhatsAppInvoice(filterName, cachedPendingListForWA, phone);
  }

  // Render Upcoming Appointments & Last 5 Sessions (Tab 2)
  function renderUpcomingAndRecent() {
    const visits = PhysioDB.getVisits();
    const upcomingDiv = document.getElementById('upcomingList');
    const recentDiv = document.getElementById('recentList');
    if (!upcomingDiv || !recentDiv) return;

    // Upcoming Appointments calculation
    const latestMap = new Map();
    visits.forEach(v => {
      const existing = latestMap.get(v.name);
      if (!existing || new Date(v.date) > new Date(existing.date)) {
        latestMap.set(v.name, v);
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
      upcomingDiv.innerHTML = `
      <div class="card" style="text-align:center; padding:20px;">
        <p style="color:var(--text-muted); margin:0; font-size:13.5px;">No upcoming sessions scheduled.</p>
      </div>`;
    } else {
      let upHtml = '';
      const phones = PhysioDB.getPatientPhones();

      upcoming.forEach(item => {
        const d = item.date;
        const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });
        const phone = phones[PhysioDB.sanitizeName(item.name)];

        upHtml += `
        <div class="card upcoming-item-card">
          <!-- Row 1: Patient Name & WhatsApp Action Badge (Exact same height as Recent Sessions .badge) -->
          <div class="card-row-head">
            <h4 class="card-item-title">${item.name}</h4>
            <button class="upcoming-wa-badge" onclick="PhysioPayments.sendAppointmentReminder('${item.name.replace(/'/g, "\\'")}', '${dateStr}', '${phone || ''}')" title="Send WhatsApp Appointment Reminder">
              ${PhysioPayments.getWhatsAppIconSVG(13)}
              <span>Remind</span>
            </button>
          </div>

          <!-- Row 2: Session Type on its own dedicated full-width line -->
          <div class="card-row-therapy">
            <span class="therapy-pill">🩺 ${item.visit.sessionType || "Physiotherapy Session"}</span>
          </div>

          <!-- Row 3: Meta info with | separators -->
          <div class="card-row-meta">
            <span class="meta-item-highlight">📅 ${dateStr}</span>
            <span class="meta-sep">|</span>
            <span class="meta-item">📍 ${item.visit.location || "Clinic"}</span>
            <span class="meta-sep">|</span>
            <span class="meta-item" style="color:var(--primary); font-weight:600;">⏳ Scheduled</span>
          </div>
        </div>`;
      });
      upcomingDiv.innerHTML = upHtml;
    }

    // Last 5 Sessions (Tab 2) - Dynamic multi-row stacked architecture
    const sortedVisits = [...visits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const top5 = sortedVisits.slice(0, 5);

    let recentHTML = '';
    const displayStyle = deleteMode ? 'block' : 'none';

    top5.forEach(v => {
      const d = v.date ? new Date(v.date) : null;
      const dateStr = d && !isNaN(d) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : "No Date";
      const fee = parseFloat(v.totalFee) || 0;
      const paid = parseFloat(v.amountPaid) || 0;
      const isPaid = paid >= fee && fee > 0;

      recentHTML += `
      <div class="card session-item-card">
        <!-- Row 1: Patient Name & Payment Status Badge -->
        <div class="card-row-head">
          <h4 class="card-item-title">${v.name}</h4>
          <span class="badge ${isPaid ? 'badge-success' : 'badge-danger'}">
            ${isPaid ? '✓ Paid' : 'Due: ₹' + (fee - paid).toLocaleString('en-IN')}
          </span>
        </div>

        <!-- Row 2: Therapy / Session Type (Full width, can have short or long words, never breaks other rows!) -->
        <div class="card-row-therapy">
          <span class="therapy-pill">🩺 ${v.sessionType || "Regular Session"}</span>
        </div>

        <!-- Row 3: Meta details with clean | separators and tabular alignment -->
        <div class="card-row-meta">
          <span class="meta-item">📅 ${dateStr}</span>
          <span class="meta-sep">|</span>
          <span class="meta-item">📍 ${v.location || "Clinic"}</span>
          <span class="meta-sep">|</span>
          <span class="meta-item">💰 Fee: ₹${fee.toLocaleString('en-IN')}</span>
        </div>

        <!-- Delete button in edit mode -->
        <button class="delete-btn" style="display: ${displayStyle}; position: absolute; top: -8px; right: -8px; background: var(--danger); color: white; border: none; border-radius: 50%; width: 28px; height: 28px; font-size: 13px; cursor: pointer; box-shadow: var(--shadow-md);" onclick="PhysioLedger.handleDeleteVisit(${v.id})">
          ✕
        </button>
      </div>`;
    });

    recentDiv.innerHTML = recentHTML;
  }

  function toggleDeleteMode() {
    deleteMode = !deleteMode;
    const btn = document.getElementById('btnEditRecent');
    if (btn) btn.style.opacity = deleteMode ? '1' : '0.6';
    renderUpcomingAndRecent();
  }

  async function handleDeleteVisit(visitId) {
    const ok = confirm("Permanently delete this session record? This action synchronizes to the cloud.");
    if (!ok) return;

    try {
      await PhysioDB.deleteVisit(visitId);
      PhysioApp.showToast("✓ Record deleted", "info");
      renderUpcomingAndRecent();
    } catch (e) {
      PhysioApp.showToast("Error deleting visit", "error");
    }
  }

  return {
    switchLedgerView,
    renderLedger,
    loadMoreReceived,
    settlePayment,
    dispatchWhatsAppReminder,
    renderUpcomingAndRecent,
    toggleDeleteMode,
    handleDeleteVisit
  };
})();
