/**
 * Analytics & Business Intelligence Dashboard
 * Reuses Chart.js instances, generates monthly cashflow matrices, and calculates patient pain trajectories
 * Strict columnar tabular alignment for aged debtors and balances
 */

window.PhysioAnalytics = (function() {
  let cashflowChart = null;
  let painChart = null;

  function initYearFilter() {
    const filter = document.getElementById('dashYearFilter');
    if (!filter) return;

    const visits = PhysioDB.getVisits();
    const years = new Set();
    visits.forEach(v => {
      if (v.date) {
        const y = new Date(v.date).getFullYear();
        if (!isNaN(y)) years.add(y);
      }
    });

    const currentSelected = filter.value || 'All';
    filter.innerHTML = '<option value="All">All-Time</option>';
    Array.from(years).sort((a, b) => b - a).forEach(y => {
      filter.appendChild(new Option(y, y));
    });

    if (Array.from(years).includes(parseInt(currentSelected, 10))) {
      filter.value = currentSelected;
    }
  }

  function renderDashboard() {
    initYearFilter();
    const visits = PhysioDB.getVisits();
    if (visits.length === 0) return;

    const yearFilter = document.getElementById('dashYearFilter').value;
    let totalBilled = 0;
    let totalCollected = 0;
    let totalPending = 0;

    const monthDataMap = {};
    const agedDebtors = {};
    const locationRevenueMap = {};
    const activePatientSet = new Set();
    let totalVisitsCount = 0;
    let documentedSessions = 0;
    let sumPainReliefPct = 0;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    if (yearFilter !== "All") {
      monthNames.forEach(m => { monthDataMap[m] = { collected: 0, pending: 0 }; });
    }

    visits.forEach(v => {
      const d = v.date ? new Date(v.date) : null;
      if (!d || isNaN(d)) return;

      const rowYear = d.getFullYear().toString();
      if (yearFilter !== "All" && rowYear !== yearFilter) return;

      const fee = parseFloat(v.totalFee) || 0;
      const paid = parseFloat(v.amountPaid) || 0;
      const balance = fee - paid;
      const pType = (v.paymentType || '').toLowerCase().trim();

      totalBilled += fee;
      totalCollected += paid;
      totalVisitsCount++;
      if (v.name) activePatientSet.add(v.name);

      // Track revenue by practice location
      const loc = (v.location || 'Clinic').trim();
      if (!locationRevenueMap[loc]) {
        locationRevenueMap[loc] = { collected: 0, billed: 0, visits: 0 };
      }
      locationRevenueMap[loc].collected += paid;
      locationRevenueMap[loc].billed += fee;
      locationRevenueMap[loc].visits += 1;

      // Track clinical recovery index
      if (v.painBefore !== null && v.painAfter !== null && v.painBefore > 0) {
        documentedSessions++;
        const relief = v.painBefore - v.painAfter;
        const reliefPct = Math.max(0, (relief / v.painBefore) * 100);
        sumPainReliefPct += reliefPct;
      }

      const mShort = monthNames[d.getMonth()];
      const mLabel = yearFilter === "All" ? `${mShort} '${rowYear.slice(-2)}` : mShort;

      if (!monthDataMap[mLabel]) monthDataMap[mLabel] = { collected: 0, pending: 0 };
      monthDataMap[mLabel].collected += paid;

      if (balance > 0 || pType === 'pending') {
        totalPending += balance;
        monthDataMap[mLabel].pending += balance;

        const sortableKey = `${rowYear}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const displayMonth = `${d.toLocaleString('default', { month: 'long' })} ${rowYear}`;

        if (!agedDebtors[sortableKey]) agedDebtors[sortableKey] = { label: displayMonth, patients: {} };
        if (!agedDebtors[sortableKey].patients[v.name]) {
          agedDebtors[sortableKey].patients[v.name] = { count: 0, amount: 0 };
        }
        agedDebtors[sortableKey].patients[v.name].count += 1;
        agedDebtors[sortableKey].patients[v.name].amount += balance;
      }
    });

    document.getElementById('dashBilled').innerText = PhysioPayments.formatINR(totalBilled);
    document.getElementById('dashCollected').innerText = PhysioPayments.formatINR(totalCollected);
    document.getElementById('dashPending').innerText = PhysioPayments.formatINR(totalPending);

    // Practice-Wide Clinical Recovery Index
    const recoveryPctEl = document.getElementById('dashRecoveryPct');
    const recoveryMetaEl = document.getElementById('dashRecoveryMeta');
    if (recoveryPctEl && recoveryMetaEl) {
      if (documentedSessions > 0) {
        const avgRelief = (sumPainReliefPct / documentedSessions).toFixed(1);
        recoveryPctEl.innerText = `${avgRelief}%`;
        recoveryMetaEl.innerText = `Average pain relief across ${documentedSessions} documented sessions`;
      } else {
        recoveryPctEl.innerText = `—`;
        recoveryMetaEl.innerText = `Awaiting documented before/after pain records`;
      }
    }

    // Practice Financial KPIs (Average Fee, Per-Patient, Realization Rate)
    const avgFee = totalVisitsCount > 0 ? Math.round(totalCollected / totalVisitsCount) : 0;
    const avgPerPatient = activePatientSet.size > 0 ? Math.round(totalCollected / activePatientSet.size) : 0;
    const realizationRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 100;

    const avgFeeEl = document.getElementById('dashAvgFee');
    const avgPatientEl = document.getElementById('dashAvgPerPatient');
    const realizationPctEl = document.getElementById('dashRealizationPct');
    const realizationRateBadge = document.getElementById('dashRealizationRate');

    if (avgFeeEl) avgFeeEl.innerText = `₹${avgFee.toLocaleString('en-IN')}`;
    if (avgPatientEl) avgPatientEl.innerText = `₹${avgPerPatient.toLocaleString('en-IN')}`;
    if (realizationPctEl) realizationPctEl.innerText = `${realizationRate}%`;
    if (realizationRateBadge) realizationRateBadge.innerText = `${realizationRate}% Realized`;

    // Revenue by Practice Location Breakdown
    const locationContainer = document.getElementById('dashLocationEarningsList');
    const locationSummaryText = document.getElementById('earningsLocationSummaryText');
    if (locationContainer) {
      const sortedLocations = Object.entries(locationRevenueMap).sort((a, b) => b[1].collected - a[1].collected);
      if (locationSummaryText) {
        locationSummaryText.innerText = `📍 View Location Breakdown (${sortedLocations.length} Locations)`;
      }
      let locHtml = '';
      sortedLocations.forEach(([locName, data]) => {
        const pct = totalCollected > 0 ? Math.round((data.collected / totalCollected) * 100) : 0;
        locHtml += `
        <div class="earnings-location-item">
          <div class="earnings-loc-info">
            <span class="earnings-loc-name">📍 ${locName} <span style="color:var(--text-muted); font-size:11px; font-weight:400;">(${data.visits} visits)</span></span>
            <span class="earnings-loc-amount">₹${data.collected.toLocaleString('en-IN')} <strong style="color:var(--text-muted); font-size:11px;">(${pct}%)</strong></span>
          </div>
          <div class="earnings-loc-bar-bg">
            <div class="earnings-loc-bar-fill" style="width: ${pct}%;"></div>
          </div>
        </div>`;
      });
      locationContainer.innerHTML = locHtml;
    }

    // Update Cashflow Chart
    let labels = Object.keys(monthDataMap);
    if (yearFilter === "All" && labels.length > 8) {
      labels = labels.slice(-8); // Keep last 8 months for clear mobile display
    }

    const collectedSeries = labels.map(l => monthDataMap[l].collected);
    const pendingSeries = labels.map(l => monthDataMap[l].pending);

    const canvas = document.getElementById('cashflowChart');
    if (canvas && window.Chart) {
      const ctx = canvas.getContext('2d');
      if (cashflowChart) {
        cashflowChart.data.labels = labels;
        cashflowChart.data.datasets[0].data = collectedSeries;
        cashflowChart.data.datasets[1].data = pendingSeries;
        cashflowChart.update('none');
      } else {
        cashflowChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [
              { label: 'Collected (₹)', data: collectedSeries, backgroundColor: '#10b981', stack: 'Stack 0', borderRadius: 4 },
              { label: 'Pending (₹)', data: pendingSeries, backgroundColor: '#ef4444', stack: 'Stack 0', borderRadius: 4 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
              legend: { position: 'top' },
              title: { display: true, text: 'Monthly Financial Velocity' }
            },
            scales: {
              x: { stacked: true, grid: { display: false } },
              y: { stacked: true, grid: { color: 'rgba(0,0,0,0.05)' } }
            },
            animation: false
          }
        });
      }
    }

    // Render Aged Debtors Breakdown with Strict Columnar Alignment
    const agedList = document.getElementById('agedDebtorsList');
    if (agedList) {
      const sortedKeys = Object.keys(agedDebtors).sort((a, b) => b.localeCompare(a));
      if (sortedKeys.length === 0) {
        agedList.innerHTML = '<p style="color:var(--text-muted); font-size:14px; text-align:center; padding:16px;">No outstanding dues for this period.</p>';
      } else {
        let agedHtml = '';
        sortedKeys.forEach(k => {
          const m = agedDebtors[k];
          let monthTotal = 0;
          Object.values(m.patients).forEach(st => { monthTotal += st.amount; });

          agedHtml += `
          <div class="debtors-month-card">
            <div class="debtors-month-header">
              <span class="debtors-month-title">📅 ${m.label}</span>
              <span class="debtors-month-sum">Due: ₹${monthTotal.toLocaleString('en-IN')}</span>
            </div>
            <div class="debtors-table-container">`;

          Object.keys(m.patients).sort().forEach(pName => {
            const st = m.patients[pName];
            agedHtml += `
            <div class="debtor-table-row">
              <div class="col-patient-name" title="${pName}">${pName}</div>
              <div class="col-visit-badge">${st.count} visit${st.count > 1 ? 's' : ''}</div>
              <div class="col-divider">|</div>
              <div class="col-due-amount">₹${st.amount.toLocaleString('en-IN')}</div>
            </div>`;
          });

          agedHtml += `</div></div>`;
        });
        agedList.innerHTML = agedHtml;
      }
    }

    // Refresh WhatsApp Outreach Message Preview
    renderOutreachPreview();
  }

  /* -------------------------------------------------------------------------
   * Clinic Outreach & Referral WhatsApp Broadcaster
   * ------------------------------------------------------------------------- */
  function getPromoMessage() {
    const phone = (PhysioConfig.CLINIC_PHONE || "8108245286").replace(/\D/g, '');
    const cleanPhone = phone.length === 10 ? `91${phone}` : phone;
    const waBookingUrl = `https://wa.me/${cleanPhone}?text=Hello%20Dr.%20Anjali,%20I%20would%20like%20to%20consult%20for%20physiotherapy`;

    return `🌸 *Is Body Pain or Stiffness Slowing You Down?* 🌸

Most people ignore persistent neck pain, lower back stiffness, or joint aches until it affects daily life. Painkillers only mask the symptoms — real healing begins when you fix the *root cause*.

🌿 *Dr. Anjali Vishwakarma*
_Physiotherapy & Rehabilitation Specialist_

✨ *Specialized Treatments Offered:*
• Chronic Back & Neck Pain Relief
• Frozen Shoulder, Knee & Sciatica Care
• Advanced Manual Therapy & Joint Mobilization
• Craniosacral Therapy (Deep Healing & Migraine Relief)
• Posture Correction & Personalized Rehab Exercises
• 🏠 Clinic & Home Visit Consultations Available

🌟 *"Move better, feel lighter, live pain-free."*

📲 *Book a Consultation / Inquire via WhatsApp:*
👉 ${waBookingUrl}

_(Feel free to forward this to friends or family members who might need expert pain relief!)_`;
  }

  function renderOutreachPreview() {
    const previewEl = document.getElementById('outreachMessagePreview');
    if (previewEl) {
      previewEl.textContent = getPromoMessage();
    }
  }

  function sharePromoWhatsApp() {
    const msg = getPromoMessage();
    // Leaving out phone number in api.whatsapp.com/send allows selecting any individual, group, or broadcast list
    const shareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(shareUrl, '_blank');
  }

  function copyPromoMessage() {
    const text = getPromoMessage();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        PhysioApp.showToast("✓ WhatsApp message copied to clipboard!", "success");
      }).catch(() => {
        fallbackCopyText(text);
      });
    } else {
      fallbackCopyText(text);
    }
  }

  function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      PhysioApp.showToast("✓ WhatsApp message copied to clipboard!", "success");
    } catch (e) {
      PhysioApp.showToast("Could not copy automatically", "info");
    }
    document.body.removeChild(ta);
  }

  // Patient Individual Analytics (Pain Progression)
  function renderPatientAnalytics() {
    const name = document.getElementById('analyticsPatientSelect').value;
    const dataContainer = document.getElementById('patientAnalyticsData');
    const agedContainer = document.getElementById('agedDebtorsContainer');
    if (!dataContainer) return;

    if (!name) {
      dataContainer.style.display = 'none';
      if (agedContainer) agedContainer.style.display = 'block';
      return;
    }

    if (agedContainer) agedContainer.style.display = 'none';

    const visits = PhysioDB.getVisits();
    const patientVisits = visits.filter(v => v.name === name);
    patientVisits.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let totalSessions = patientVisits.length;
    let totalSpent = 0;
    let totalPending = 0;
    let dates = [];
    let painBefore = [];
    let painAfter = [];

    patientVisits.forEach(v => {
      const fee = parseFloat(v.totalFee) || 0;
      const paid = parseFloat(v.amountPaid) || 0;
      totalSpent += paid;
      if (fee > paid) totalPending += (fee - paid);

      if (v.date) {
        const d = new Date(v.date);
        dates.push(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
      }
      painBefore.push(v.painBefore != null ? v.painBefore : null);
      painAfter.push(v.painAfter != null ? v.painAfter : null);
    });

    document.getElementById('patTotalSessions').innerText = totalSessions;
    document.getElementById('patTotalSpent').innerText = PhysioPayments.formatINR(totalSpent);
    document.getElementById('patTotalPending').innerText = PhysioPayments.formatINR(totalPending);
    dataContainer.style.display = 'block';

    const canvas = document.getElementById('painChart');
    if (canvas && window.Chart) {
      const ctx = canvas.getContext('2d');
      if (painChart) {
        painChart.data.labels = dates;
        painChart.data.datasets[0].data = painBefore;
        painChart.data.datasets[1].data = painAfter;
        painChart.update('none');
      } else {
        painChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: dates,
            datasets: [
              { label: 'Pain Before (1-10)', data: painBefore, borderColor: '#ef4444', backgroundColor: '#ef4444', tension: 0.3, pointRadius: 4 },
              { label: 'Pain After (1-10)', data: painAfter, borderColor: '#10b981', backgroundColor: '#10b981', tension: 0.3, pointRadius: 4 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
              y: { min: 0, max: 10, ticks: { stepSize: 1 } },
              x: { grid: { display: false } }
            },
            animation: false
          }
        });
      }
    }
  }

  return {
    renderDashboard,
    renderPatientAnalytics,
    sharePromoWhatsApp,
    copyPromoMessage,
    getPromoMessage
  };
})();
