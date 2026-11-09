/**
 * Clinical Workflow & Patient Visit Management
 * Handles ergonomic pain selectors, quick-pick patient carousel, visit logging, and clinical timelines
 */

window.PhysioClinical = (function() {
  let isSubmitting = false;

  // Initialize Pain Scale Chips (1-10)
  function initPainSelectors() {
    const beforeContainer = document.getElementById('painBeforeChips');
    const afterContainer = document.getElementById('painAfterChips');
    if (!beforeContainer || !afterContainer) return;

    beforeContainer.innerHTML = createPainChipsHTML('painBefore');
    afterContainer.innerHTML = createPainChipsHTML('painAfter');
  }

  function createPainChipsHTML(inputPrefix) {
    let html = '';
    for (let i = 1; i <= 10; i++) {
      html += `<div class="pain-chip" data-val="${i}" onclick="PhysioClinical.selectPainChip('${inputPrefix}', ${i})">${i}</div>`;
    }
    return html;
  }

  function selectPainChip(inputPrefix, value) {
    const hiddenInput = document.getElementById(inputPrefix);
    if (!hiddenInput) return;

    hiddenInput.value = value;
    const container = document.getElementById(inputPrefix + 'Chips');
    if (container) {
      container.querySelectorAll('.pain-chip').forEach(chip => {
        if (parseInt(chip.getAttribute('data-val'), 10) === value) {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      });
    }
  }

  function resetPainChips() {
    ['painBefore', 'painAfter'].forEach(prefix => {
      const input = document.getElementById(prefix);
      if (input) input.value = '';
      const container = document.getElementById(prefix + 'Chips');
      if (container) {
        container.querySelectorAll('.pain-chip').forEach(c => c.classList.remove('active'));
      }
    });
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

    // Sort visits descending
    const sorted = [...visits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const uniqueNames = [];
    for (let v of sorted) {
      if (v.name && !uniqueNames.includes(v.name)) {
        uniqueNames.push(v.name);
      }
      if (uniqueNames.length >= 6) break;
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

    // Auto-fill recent visit parameters
    const visits = PhysioDB.getVisits();
    const patientVisits = visits.filter(v => v.name === patientName);
    if (patientVisits.length > 0) {
      patientVisits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const latest = patientVisits[0];
      if (latest.location) document.getElementById('location').value = latest.location;
      if (latest.sessionType) document.getElementById('sessionType').value = latest.sessionType;
      if (latest.totalFee) document.getElementById('totalFee').value = latest.totalFee;
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

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerText = "Saving Record...";
    isSubmitting = true;

    const visitData = {
      date: document.getElementById('date').value,
      name: rawName,
      location: document.getElementById('location').value,
      sessionType: document.getElementById('sessionType').value,
      painBefore: document.getElementById('painBefore').value,
      painAfter: document.getElementById('painAfter').value,
      totalFee: document.getElementById('totalFee').value,
      amountPaid: document.getElementById('amountPaid').value,
      paymentType: document.getElementById('paymentType').value,
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

      // Reset Form
      document.getElementById('entryForm').reset();
      document.getElementById('date').valueAsDate = new Date();
      document.getElementById('amountPaid').value = "0";
      document.getElementById('name').value = "";
      document.getElementById('btnTab1Patient').innerHTML = "🔍 Search or enter new...";
      resetPainChips();
      renderQuickPatientsBar();

    } catch (err) {
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
      timeline.innerHTML = '<div class="card" style="text-align:center;"><p style="color:var(--text-muted);">Please select a patient above to view treatment history.</p></div>';
      if (scheduleCard) scheduleCard.style.display = "none";
      return;
    }

    if (scheduleCard) scheduleCard.style.display = "block";
    document.getElementById('apptStatusMsg').innerText = "";
    document.getElementById('newNextApptDate').value = "";

    const visits = PhysioDB.getVisits();
    const patientVisits = visits.filter(v => v.name === selectedName);

    if (patientVisits.length === 0) {
      timeline.innerHTML = '<div class="card" style="text-align:center;"><p>No records found for this patient.</p></div>';
      return;
    }

    patientVisits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    let html = '';
    patientVisits.forEach(v => {
      const d = v.date ? new Date(v.date) : null;
      const displayDate = d && !isNaN(d) ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : "No Date";
      
      html += `
      <div class="card" style="border-left: 4px solid var(--primary);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
          <span style="font-weight:700; color:var(--primary); font-size:15px;">${displayDate}</span>
          <span class="badge badge-success">${v.sessionType || "Session"}</span>
        </div>
        <div style="background: var(--bg-input); padding: 10px; border-radius: var(--radius-sm); margin-bottom: 8px; display:flex; justify-content:space-around; text-align:center;">
          <div><div style="font-size:11px; color:var(--text-muted); font-weight:700;">PAIN BEFORE</div><strong style="font-size:17px; color:var(--danger);">${v.painBefore || "-"}</strong></div>
          <div style="color:var(--text-muted); font-size:20px; line-height:1.2;">→</div>
          <div><div style="font-size:11px; color:var(--text-muted); font-weight:700;">PAIN AFTER</div><strong style="font-size:17px; color:var(--success);">${v.painAfter || "-"}</strong></div>
        </div>
        <p style="margin: 4px 0; font-size: 14px; line-height:1.5;"><strong>Notes:</strong> ${v.notes || "No clinical observations recorded."}</p>
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
    selectPainChip,
    resetPainChips,
    renderQuickPatientsBar,
    quickSelectPatient,
    handleEntryFormSubmit,
    renderPatientHistory,
    saveNextAppt
  };
})();
