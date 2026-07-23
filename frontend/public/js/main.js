// ─── EVM Inventory System — Main JavaScript ──────────────────

// ─── MODAL HELPERS ───────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
}
// Close on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
    document.body.style.overflow = '';
  }
});

// ─── DYNAMIC DROPDOWN CASCADE ────────────────────────────────

// Step 1: Dzongkhag → load Constituencies, clear Gewog
async function loadConstituencies(dzongkhagId, constSelect, selectedId = null) {
  if (!constSelect) return;
  constSelect.innerHTML = '<option value="">-- Loading... --</option>';

  // Clear any downstream gewog select
  const gewogSel = document.getElementById('create-gewog') ||
                   document.getElementById('gewog_id');
  if (gewogSel) gewogSel.innerHTML = '<option value="">-- Select Constituency First --</option>';

  if (!dzongkhagId) {
    constSelect.innerHTML = '<option value="">-- Select Dzongkhag First --</option>';
    return;
  }
  try {
    const res  = await fetch(`/api/constituencies/${dzongkhagId}`);
    const data = await res.json();
    constSelect.innerHTML = '<option value="">-- Select Constituency --</option>';
    data.forEach(c => {
      const opt = new Option(c.name, c.id);
      if (selectedId && c.id == selectedId) opt.selected = true;
      constSelect.add(opt);
    });
    // If pre-selected (edit mode), auto-load its gewogs
    if (selectedId) {
      const gSel = document.getElementById('create-gewog') || document.getElementById('gewog_id');
      if (gSel) await loadGewogsByConstituency(selectedId, gSel, window._selectedGewogId);
    }
  } catch (err) {
    console.error('loadConstituencies error:', err);
    constSelect.innerHTML = '<option value="">Error loading constituencies</option>';
  }
}

// Step 2: Constituency → load Gewogs
async function loadGewogsByConstituency(constituencyId, gewogSelect, selectedId = null) {
  if (!gewogSelect) return;
  gewogSelect.innerHTML = '<option value="">-- Loading... --</option>';
  if (!constituencyId) {
    gewogSelect.innerHTML = '<option value="">-- Select Constituency First --</option>';
    return;
  }
  try {
    const res  = await fetch(`/api/gewogs/by-constituency/${constituencyId}`);
    const data = await res.json();
    gewogSelect.innerHTML = '<option value="">-- Select Gewog --</option>';
    data.forEach(g => {
      const opt = new Option(g.name, g.id);
      if (selectedId && g.id == selectedId) opt.selected = true;
      gewogSelect.add(opt);
    });
  } catch (err) {
    console.error('loadGewogsByConstituency error:', err);
    gewogSelect.innerHTML = '<option value="">Error loading gewogs</option>';
  }
}

// Dzongkhag → load DzEO/DzERO/EA officers (for Admin equipment assignment)
async function loadOfficersByDzongkhag(dzongkhagId, officerSelect, selectedId = null) {
  if (!officerSelect) return;
  officerSelect.innerHTML = '<option value="">-- Loading... --</option>';
  if (!dzongkhagId) {
    officerSelect.innerHTML = '<option value="">-- Select Dzongkhag First --</option>';
    return;
  }
  try {
    const res  = await fetch(`/api/officers/by-dzongkhag/${dzongkhagId}`);
    const data = await res.json();
    officerSelect.innerHTML = '<option value="">-- Select Officer --</option>';
    data.forEach(o => {
      const opt = new Option(`${o.full_name} (${o.role})`, o.id);
      if (selectedId && o.id == selectedId) opt.selected = true;
      officerSelect.add(opt);
    });
    if (data.length === 0) {
      officerSelect.innerHTML = '<option value="">No active DzEO/DzERO/EA in this Dzongkhag yet</option>';
    }
  } catch (err) {
    console.error('loadOfficersByDzongkhag error:', err);
    officerSelect.innerHTML = '<option value="">Error loading officers</option>';
  }
}

// Step 3: Gewog → load Polling Stations (for Presiding Officer assignment)
async function loadPollingStationsByGewog(gewogId, stationSelect, selectedId = null) {
  if (!stationSelect) return;
  stationSelect.innerHTML = '<option value="">-- Loading... --</option>';
  if (!gewogId) {
    stationSelect.innerHTML = '<option value="">-- Select Gewog First --</option>';
    return;
  }
  try {
    const res  = await fetch(`/api/polling-stations/by-gewog/${gewogId}`);
    const data = await res.json();
    stationSelect.innerHTML = '<option value="">-- Select Polling Station --</option>';
    data.forEach(s => {
      const opt = new Option(s.name, s.id);
      if (selectedId && s.id == selectedId) opt.selected = true;
      stationSelect.add(opt);
    });
    if (data.length === 0) {
      stationSelect.innerHTML = '<option value="">No Polling Stations registered for this Gewog yet</option>';
    }
  } catch (err) {
    console.error('loadPollingStationsByGewog error:', err);
    stationSelect.innerHTML = '<option value="">Error loading polling stations</option>';
  }
}

// Generic handler called by onchange="onConstituencyChange(this.value)"
async function onConstituencyChange(constituencyId) {
  const gewogSel = document.getElementById('gewog_id') ||
                   document.getElementById('create-gewog') ||
                   document.getElementById('issue-gewog');
  if (gewogSel) await loadGewogsByConstituency(constituencyId, gewogSel);
}

// ─── USER FORM: toggle fields by role ─────────────────────────
function toggleRoleFields(prefix, role) {
  const dzong   = document.getElementById(`${prefix}-dzong-group`);
  const cnst    = document.getElementById(`${prefix}-const-group`);
  const gewog   = document.getElementById(`${prefix}-gewog-group`);
  const station = document.getElementById(`${prefix}-station-group`);

  if (dzong)  dzong.style.display  = (role && role !== 'Admin') ? 'block' : 'none';
  if (cnst)   cnst.style.display   = ['RO', 'Presiding Officer'].includes(role) ? 'block' : 'none';
  // RO only needs Dzongkhag + Constituency. Gewog / Polling Station are
  // only relevant for a Presiding Officer.
  if (gewog)  gewog.style.display  = role === 'Presiding Officer' ? 'block' : 'none';
  if (station) station.style.display = role === 'Presiding Officer' ? 'block' : 'none';

  // Clear selects when role changes
  const cSel = document.getElementById(`${prefix}-const`);
  const gSel = document.getElementById(`${prefix}-gewog`);
  const sSel = document.getElementById(`${prefix}-station`);
  if (cSel)  cSel.innerHTML  = '<option value="">-- Select Dzongkhag First --</option>';
  if (role !== 'Presiding Officer') {
    if (gSel)  gSel.innerHTML  = '<option value="">-- Select Constituency First --</option>';
    if (sSel)  sSel.innerHTML = '<option value="">-- Select Gewog First --</option>';
  }
}

// ─── EDIT USER modal pre-fill ─────────────────────────────────
function openEditModal(user) {
  document.getElementById('edit-user-form').action = `/admin/users/${user.id}/edit`;
  document.getElementById('edit-full-name').value   = user.full_name  || '';
  document.getElementById('edit-email').value        = user.email      || '';
  const editUsername = document.getElementById('edit-username');
  const editPassword  = document.getElementById('edit-password');
  if (editUsername) editUsername.value = user.username || '';
  if (editPassword)  editPassword.value = '';
  document.getElementById('edit-role-display').value = user.role       || '';
  toggleRoleFields('edit', user.role);

  const dzSel = document.getElementById('edit-dzong');
  if (dzSel) dzSel.value = user.dzongkhag_id || '';

  const constSel   = document.getElementById('edit-const');
  const gewogSel    = document.getElementById('edit-gewog');
  const stationSel  = document.getElementById('edit-station');
  if (['RO', 'Presiding Officer'].includes(user.role) && user.dzongkhag_id && constSel) {
    loadConstituencies(user.dzongkhag_id, constSel, user.constituency_id).then(() => {
      if (user.role === 'Presiding Officer' && user.constituency_id && gewogSel) {
        loadGewogsByConstituency(user.constituency_id, gewogSel, user.gewog_id).then(() => {
          if (user.gewog_id && stationSel) {
            loadPollingStationsByGewog(user.gewog_id, stationSel, user.polling_station_id);
          }
        });
      }
    });
  }

  openModal('modal-edit');
}

// ─── CONFIRM ACTION ───────────────────────────────────────────
function confirmDelete(formId, message) {
  if (confirm(message || 'Are you sure?')) {
    const form = document.getElementById(formId);
    if (form) form.submit();
  }
}

// ─── RO: show/hide fault type when Non-Functional selected ────
function toggleFaultType(val) {
  const grp = document.getElementById('fault-type-group');
  const sel = document.getElementById('fault-type');
  if (!grp || !sel) return;
  if (val === 'Non-Functional') {
    grp.style.display = 'block';
    sel.setAttribute('required', 'required');
  } else {
    grp.style.display = 'none';
    sel.removeAttribute('required');
    sel.value = '';
  }
}

// ─── Issue To: constituency → gewogs + officers ───────────────
async function filterOfficersByConstituency(constituencyId) {
  // Load gewogs
  const gewogSel = document.getElementById('issue-gewog');
  if (gewogSel) await loadGewogsByConstituency(constituencyId, gewogSel);

  // Filter officers from embedded JSON
  const officerSel = document.getElementById('issue-officer');
  if (!officerSel) return;
  officerSel.innerHTML = '<option value="">-- Select Officer --</option>';
  const officers = window.allOfficers || [];
  const filtered = officers.filter(o => String(o.constituency_id) === String(constituencyId));
  if (filtered.length === 0) {
    officerSel.innerHTML = '<option value="">No officer assigned to this constituency</option>';
  } else {
    filtered.forEach(o => officerSel.add(new Option(`${o.full_name} (${o.role})`, o.id)));
  }
}

// ─── AUTO-DISMISS ALERTS ─────────────────────────────────────
setTimeout(() => {
  document.querySelectorAll('.alert').forEach(a => {
    a.style.transition = 'opacity 0.5s';
    a.style.opacity = '0';
    setTimeout(() => a.remove(), 500);
  });
}, 4000);

// ─── ACTIVE NAV LINK ─────────────────────────────────────────
document.querySelectorAll('.sidebar-nav a').forEach(link => {
  if (link.href === window.location.href) link.classList.add('active');
});
