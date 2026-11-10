/**
 * Clinical Workflow & Patient Visit Management
 * Handles ergonomic pain selectors, quick-pick patient carousel, visit logging, and clinical timelines
 */

window.PhysioClinical = (function() {
  let isSubmitting = false;

  const PAIN_LEVELS = {
    0: { label: "None", emoji: "😄", color: "#10b981" },
    1: { label: "Mild", emoji: "😊", color: "#10b981" },
    2: { label: "Mild", emoji: "😊", color: "#10b981" },
    3: { label: "Mild", emoji: "🙂", color: "#10b981" },
    4: { label: "Moderate", emoji: "😐", color: "#f59e0b" },
    5: { label: "Moderate", emoji: "😐", color: "#f59e0b" },
    6: { label: "Moderate", emoji: "😕", color: "#f59e0b" },
    7: { label: "Severe", emoji: "😣", color: "#ef4444" },
    8: { label: "Severe", emoji: "😣", color: "#ef4444" },
    9: { label: "Extreme", emoji: "😫", color: "#dc2626" },
    10: { label: "Extreme", emoji: "😭", color: "#991b1b" }
  };

  // Initialize Dual Ergonomic Pain Module
  function initPainSelectors() {
    updatePainDisplay('painBefore');
    updatePainDisplay('painAfter');
    updatePainDelta();
  }

  function adjustPain(prefix, delta) {
    const input = document.getElementById(prefix);
    if (!input) return;

    let current = (input.value === '' || input.value === null) ? null : parseInt(input.value, 10);
    let next;
    if (current === null) {
      next = delta > 0 ? (prefix === 'painAfter' ? 3 : 5) : 0;
    } else {
      next = current + delta;
      if (next < 0) next = 0;
      if (next > 10) next = 10;
    }

    input.value = next;
    updatePainDisplay(prefix);
    updatePainDelta();
  }

  function setPainDirect(prefix, val) {
    const input = document.getElementById(prefix);
    if (!input) return;
    input.value = (val === '' || val === null) ? '' : val;
    updatePainDisplay(prefix);
    updatePainDelta();
  }

  function togglePainDirectPrompt(prefix) {
    const input = document.getElementById(prefix);
    if (!input) return;
    const isBefore = prefix === 'painBefore';
    const choice = prompt(`Enter Pain Score (0 to 10) ${isBefore ? 'BEFORE' : 'AFTER'} session (or leave blank to clear):`, input.value || '');
    if (choice === null) return;
    const clean = choice.trim();
    if (clean === '') {
      input.value = '';
    } else {
      const num = parseInt(clean, 10);
      if (!isNaN(num) && num >= 0 && num <= 10) {
        input.value = num;
      }
    }
    updatePainDisplay(prefix);
    updatePainDelta();
  }

  function updatePainDisplay(prefix) {
    const input = document.getElementById(prefix);
    const suffix = prefix === 'painBefore' ? 'PainBefore' : 'PainAfter';
    const valEl = document.getElementById('val' + suffix);
    const tagEl = document.getElementById('tag' + suffix);
    const moduleEl = document.getElementById('module' + suffix);
    if (!input || !valEl || !tagEl) return;

    const val = (input.value === '' || input.value === null) ? null : parseInt(input.value, 10);
    if (val === null) {
      valEl.innerText = '—';
      tagEl.innerText = 'Optional';
      tagEl.style.background = 'var(--bg-input)';
      tagEl.style.color = 'var(--text-muted)';
      if (moduleEl) moduleEl.style.borderColor = 'var(--border-subtle)';
    } else {
      const info = PAIN_LEVELS[val] || { label: "Score " + val, emoji: "", color: "var(--primary)" };
      valEl.innerText = val;
      tagEl.innerText = `${info.emoji} ${info.label}`;
      tagEl.style.background = info.color + '22';
      tagEl.style.color = info.color;
      if (moduleEl) moduleEl.style.borderColor = info.color + '77';
    }
  }

  function updatePainDelta() {
    const bInput = document.getElementById('painBefore');
    const aInput = document.getElementById('painAfter');
    const deltaLabel = document.getElementById('painDeltaLabel');
    const deltaPillar = document.getElementById('painDeltaPillar');
    if (!bInput || !aInput || !deltaLabel || !deltaPillar) return;

    const b = (bInput.value === '' || bInput.value === null) ? null : parseInt(bInput.value, 10);
    const a = (aInput.value === '' || aInput.value === null) ? null : parseInt(aInput.value, 10);

    if (b !== null && a !== null) {
      const diff = b - a;
      if (diff > 0) {
        const pct = Math.round((diff / (b || 1)) * 100);
        deltaLabel.innerHTML = `<strong>−${diff}</strong> (${pct}% Relief)`;
        deltaPillar.className = 'pain-delta-pillar positive';
      } else if (diff === 0) {
        deltaLabel.innerHTML = `No change`;
        deltaPillar.className = 'pain-delta-pillar neutral';
      } else {
        deltaLabel.innerHTML = `+${Math.abs(diff)} increase`;
        deltaPillar.className = 'pain-delta-pillar negative';
      }
    } else {
      deltaLabel.innerText = 'Relief Delta';
      deltaPillar.className = 'pain-delta-pillar idle';
    }
  }

  function resetPainChips() {
    ['painBefore', 'painAfter'].forEach(prefix => {
      const input = document.getElementById(prefix);
      if (input) input.value = '';
      updatePainDisplay(prefix);
    });
    updatePainDelta();
  }

  // Quick-Select Recent Patients Carousel
  function renderQuickPatientsBar() {
    const container = document.getElementById('quickPatientsList');
    if (!container) return;

    const visits = PhysioDB.getVisits();
    if (visits.length === 0) {
      container.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">No recent visits</span>';
      return;
    }

    const sorted = [...visits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const uniqueNames = [];
    for (let v of sorted) {
      if (v.name && !uniqueNames.includes(v.name)) {
        uniqueNames.push(v.name);
      }
      if (uniqueNames.length >= 8) break;
    }

    let html = '';
    uniqueNames.forEach(name => {
      html += `<button type="button" class="patient-chip" onclick="PhysioClinical.quickSelectPatient('${name.replace(/'/g, "\\'")}')">${name}</button>`;
    });

    container.innerHTML = html;
  }

  function quickSelectPatient(patientName) {
    const nameInput = document.getElementById('name');
    const selectBtn = document.getElementById('btnTab1Patient');
    if (nameInput) nameInput.value = patientName;
    if (selectBtn) selectBtn.innerHTML = `<strong>${patientName}</strong>`;

    // Load custom saved phone if any
    const phones = PhysioDB.getPatientPhones();
    const phoneInput = document.getElementById('patientPhone');
    if (phoneInput) {
      phoneInput.value = phones[PhysioDB.sanitizeName(patientName)] || '';
    }

    // Auto-fill recent visit parameters
    const visits = PhysioDB.getVisits();
    const patientVisits = visits.filter(v => v.name === patientName);
    if (patientVisits.length > 0) {
      patientVisits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const latest = patientVisits[0];
      if (latest.location) document.getElementById('location').value = latest.location;
      if (latest.sessionType) document.getElementById('sessionType').value = latest.sessionType;
      if (latest.totalFee) {
        document.getElementById('totalFee').value = latest.totalFee;
        const pType = document.getElementById('paymentType')?.value;
        if (pType === 'Online' || pType === 'Cash') {
          document.getElementById('amountPaid').value = latest.totalFee;
        }
      }
    }
  }

  // Handle New Visit Form Submission
  async function handleEntryFormSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    const rawName = (document.getElementById('name').value || "").trim();
    if (!rawName) {
      PhysioApp.showToast("Please choose or enter a Patient Name", "error");
      return;
    }

    const feeVal = parseFloat(document.getElementById('totalFee').value) || 0;
    const paidVal = parseFloat(document.getElementById('amountPaid').value) || 0;
    let paymentType = document.getElementById('paymentType')?.value || 'Online';

    if (paidVal === 0 && feeVal > 0) {
      paymentType = 'Pending';
    }

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerText = "Saving...";
    isSubmitting = true;

    const visitData = {
      date: document.getElementById('date').value,
      name: rawName,
      location: document.getElementById('location').value,
      sessionType: document.getElementById('sessionType').value,
      painBefore: document.getElementById('painBefore').value,
      painAfter: document.getElementById('painAfter').value,
      totalFee: feeVal,
      amountPaid: paidVal,
      paymentType: paymentType,
      nextAppt: document.getElementById('nextAppt').value,
      notes: document.getElementById('notes').value
    };

    // Save phone number if provided
    const phoneInput = document.getElementById('patientPhone');
    if (phoneInput && phoneInput.value.trim()) {
      PhysioDB.setPatientPhone(rawName, phoneInput.value.trim());
    }

    try {
      await PhysioDB.addVisit(visitData);
      PhysioApp.showToast("✓ Visit saved successfully", "success");

      // Reset Form for next record
      document.getElementById('entryForm').reset();
      document.getElementById('date').valueAsDate = new Date();
      document.getElementById('amountPaid').value = "0";
      document.getElementById('name').value = "";
      document.getElementById('btnTab1Patient').innerHTML = "Select Patient...";
      PhysioApp.setPaymentMethod('online');
      resetPainChips();
      renderQuickPatientsBar();

    } catch (err) {
      console.error(err);
      PhysioApp.showToast("Error saving session", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = "Save Session Record";
      isSubmitting = false;
    }
  }

  // Clinical Records Timeline
  function renderPatientHistory() {
    const selectedName = document.getElementById('patientSelect').value;
    const timeline = document.getElementById('historyTimeline');
    const scheduleCard = document.getElementById('scheduleCard');
    if (!timeline) return;

    if (!selectedName) {
      timeline.innerHTML = '<div class="card" style="text-align:center; padding:24px;"><p style="color:var(--text-muted); margin:0; font-size:14px;">Select a patient above to view their clinical history and pain recovery trajectory.</p></div>';
      if (scheduleCard) scheduleCard.style.display = "none";
      return;
    }

    if (scheduleCard) scheduleCard.style.display = "block";
    document.getElementById('apptStatusMsg').innerText = "";
    document.getElementById('newNextApptDate').value = "";

    const visits = PhysioDB.getVisits();
    const patientVisits = visits.filter(v => v.name === selectedName);

    if (patientVisits.length === 0) {
      timeline.innerHTML = '<div class="card" style="text-align:center; padding:20px;"><p style="margin:0; color:var(--text-muted);">No records found for this patient.</p></div>';
      return;
    }

    patientVisits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    let html = '';
    patientVisits.forEach(v => {
      const d = v.date ? new Date(v.date) : null;
      const displayDate = d && !isNaN(d) ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : "No Date";
      
      html += `
      <div class="card" style="border-left: 4px solid var(--primary); padding:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
          <span style="font-weight:700; color:var(--primary); font-size:15px;">${displayDate}</span>
          <span class="badge badge-success">${v.sessionType || "Session"}</span>
        </div>
        <div style="background: var(--bg-input); padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 10px; display:flex; justify-content:space-around; align-items:center; text-align:center;">
          <div>
            <div style="font-size:10px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Before</div>
            <strong style="font-size:18px; color:var(--danger);">${v.painBefore != null ? v.painBefore : "-"}</strong>
          </div>
          <div style="color:var(--text-muted); font-size:18px;">→</div>
          <div>
            <div style="font-size:10px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">After</div>
            <strong style="font-size:18px; color:var(--success);">${v.painAfter != null ? v.painAfter : "-"}</strong>
          </div>
        </div>
        ${v.notes ? `<p style="margin: 0; font-size: 13.5px; line-height:1.5; color:var(--text-main);"><strong>Notes:</strong> ${v.notes}</p>` : `<span style="font-size:12px; color:var(--text-muted);">No additional notes.</span>`}
      </div>`;
    });

    timeline.innerHTML = html;
  }

  // Save Next Appointment from Tab 4
  async function saveNextAppt() {
    const patientName = document.getElementById('patientSelect').value;
    const nextApptDate = document.getElementById('newNextApptDate').value;
    const statusMsg = document.getElementById('apptStatusMsg');

    if (!nextApptDate) {
      statusMsg.style.color = "var(--danger)";
      statusMsg.innerText = "Please choose a date.";
      return;
    }

    statusMsg.style.color = "var(--primary)";
    statusMsg.innerText = "Scheduling...";

    const ok = await PhysioDB.updateNextAppt(patientName, nextApptDate);
    if (ok) {
      statusMsg.style.color = "var(--success)";
      statusMsg.innerText = "✓ Appointment scheduled";
      PhysioApp.showToast("✓ Appointment scheduled", "success");
    } else {
      statusMsg.style.color = "var(--danger)";
      statusMsg.innerText = "Error scheduling.";
    }
  }

  return {
    initPainSelectors,
    adjustPain,
    setPainDirect,
    togglePainDirectPrompt,
    updatePainDisplay,
    updatePainDelta,
    resetPainChips,
    renderQuickPatientsBar,
    quickSelectPatient,
    handleEntryFormSubmit,
    renderPatientHistory,
    saveNextAppt
  };
})();
