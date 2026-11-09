/**
 * Analytics & Business Intelligence Dashboard
 * Reuses Chart.js instances, generates monthly cashflow matrices, and calculates patient pain trajectories
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

    // Render Aged Debtors Breakdown
    const agedList = document.getElementById('agedDebtorsList');
    if (agedList) {
      const sortedKeys = Object.keys(agedDebtors).sort((a, b) => b.localeCompare(a));
      if (sortedKeys.length === 0) {
        agedList.innerHTML = '<p style="color:var(--text-muted); font-size:14px;">No outstanding dues for this period.</p>';
      } else {
        let agedHtml = '';
        sortedKeys.forEach(k => {
          const m = agedDebtors[k];
          agedHtml += `<div class="month-header" style="font-weight:700; color:var(--primary); margin: 16px 0 6px 0; border-bottom: 1px solid var(--border-subtle); padding-bottom: 4px;">${m.label}</div>`;
          Object.keys(m.patients).sort().forEach(pName => {
            const st = m.patients[pName];
            agedHtml += `
            <div style="display: flex; justify-content: space-between; padding: 6px 0 6px 12px; font-size: 14px; border-bottom: 1px dashed var(--border-subtle);">
              <span>${pName}</span>
              <span style="font-weight:700; color:var(--danger);">${st.count} visit${st.count > 1 ? 's' : ''} • ₹${st.amount.toLocaleString('en-IN')}</span>
            </div>`;
          });
        });
        agedList.innerHTML = agedHtml;
      }
    }
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
    renderPatientAnalytics
  };
})();
