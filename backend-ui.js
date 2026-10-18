/* Same-origin bridge from the legacy shell to authenticated MediVault APIs. */
(() => {
  let backendStatus = null;
  let cloudMode = false;
  let cloudError = "";
  let families = [];
  let members = [];
  let records = [];
  let medications = [];
  let timeline = [];
  let shares = [];
  let profile = null;
  let familyId = "";
  let memberId = "";

  const api = async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (!(options.body instanceof FormData) && options.body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || "The request could not be completed.");
    return data;
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const selectedMember = () => members.find((item) => item.id === memberId) || members[0] || null;
  const dateLabel = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString() : "Date not set";
  const selectedRecords = () => records.filter((item) => !memberId || item.member_id === memberId);
  const selectedMeds = () => medications.filter((item) => !memberId || item.member_id === memberId);

  function showAuthConfiguration(configured) {
    if (typeof activeView !== "undefined" && activeView === "auth") {
      const note = document.querySelector(".mv-config-note");
      if (note) note.innerHTML = configured
        ? "<strong>Authentication is connected</strong><p>Sign in to open your authenticated workspace. Your private records load from MediVault APIs.</p>"
        : "<strong>Authentication is not connected</strong><p>Set the Supabase URL and publishable key to enable sign-in. This demo will not create a session or claim a successful login.</p>";
    }
  }

  async function loadWorkspace() {
    const familyResponse = await api("/api/families");
    families = familyResponse.families || [];
    if (!families.length) throw new Error("No accessible family workspace was found. Complete the database setup or contact your family administrator.");
    familyId = families[0].family_id;
    const memberResponse = await api(`/api/families/${encodeURIComponent(familyId)}/members`);
    members = memberResponse.members || [];
    if (!members.some((item) => item.id === memberId)) memberId = members[0]?.id || "";
    const memberResults = await Promise.all(members.map(async (member) => {
      const [recordResult, medicationResult, timelineResult] = await Promise.all([
        api(`/api/members/${encodeURIComponent(member.id)}/records?limit=100`),
        api(`/api/members/${encodeURIComponent(member.id)}/medications`),
        api(`/api/members/${encodeURIComponent(member.id)}/timeline?limit=100`),
      ]);
      return { member, recordResult, medicationResult, timelineResult };
    }));
    records = memberResults.flatMap(({ member, recordResult }) => (recordResult.records || []).map((record) => ({ ...record, member_name: member.display_name })));
    medications = memberResults.flatMap(({ medicationResult }) => medicationResult.medications || []);
    timeline = memberResults.flatMap(({ timelineResult }) => timelineResult.events || [])
      .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)));
    members = memberResults.map(({ member }) => {
      const latest = timeline.find((event) => event.member_id === member.id);
      return {
        ...member,
        record_count: records.filter((record) => record.member_id === member.id).length,
        latest_event: latest?.title || "No activity yet",
        initials: member.display_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
      };
    });
    try { profile = (await api("/api/profile")).profile || null; } catch { profile = null; }
    try { shares = (await api("/api/shares")).shares || []; } catch { shares = []; }
    cloudError = "";
  }

  async function enterCloudMode() {
    cloudMode = true;
    cloudError = "Loading your private workspace…";
    render("overview");
    try {
      await loadWorkspace();
      render("overview");
      notify("Your authenticated MediVault workspace is open.");
    } catch (error) {
      cloudError = error instanceof Error ? error.message : "Your workspace could not be loaded.";
      render("overview");
    }
  }

  function memberSelect() {
    return `<label class="filter-search" style="display:flex;align-items:center;gap:8px">Patient <select id="cloudMember" class="filter-select" aria-label="Select patient">${members.map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === memberId ? "selected" : ""}>${escapeHtml(m.display_name)}</option>`).join("")}</select></label>`;
  }

  function cloudHeading(kicker, title, description, action = "") {
    return `<div class="row-between"><div><div class="eyebrow">${escapeHtml(kicker)}</div><h1 class="page-title">${escapeHtml(title)}</h1><p class="page-subtitle">${escapeHtml(description)}</p></div>${action}</div>`;
  }

  function cloudErrorView() {
    return `${cloudHeading("PRIVATE WORKSPACE", "Your data is not available", "The authenticated workspace could not load its database-backed family data.")}<section class="card" role="alert" style="margin-top:20px;padding:22px"><strong>${escapeHtml(cloudError || "Database setup is incomplete.")}</strong><p class="page-subtitle">No sample health records are shown in this signed-in view.</p><button class="btn btn-primary" type="button" data-cloud-action="refresh">Retry</button></section>`;
  }

  function renderOverview() {
    const recent = [...records].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5);
    return `${cloudHeading("YOUR FAMILY HEALTH", families[0]?.families?.name || "Your workspace", "A private summary of records stored for your family.")}
      <div class="stats-grid" style="margin-top:20px"><article class="stat-card"><div class="stat-top">Family members</div><div class="stat-value">${members.length}</div></article><article class="stat-card"><div class="stat-top">Medical records</div><div class="stat-value">${records.length}</div></article><article class="stat-card"><div class="stat-top">Medications</div><div class="stat-value">${medications.length}</div></article><article class="stat-card"><div class="stat-top">Timeline events</div><div class="stat-value">${timeline.length}</div></article></div>
      <div class="row-between" style="margin:18px 0">${memberSelect()}<button class="btn btn-primary" type="button" data-cloud-action="upload">＋ Add medical record</button></div>
      <section class="card" style="padding:18px"><div class="card-head"><div><h3>Recent records</h3><p>Private records returned by your authenticated account</p></div><button class="text-link" data-view="vault">Open vault →</button></div>${recordsMarkup(recent)}</section>`;
  }

  function recordsMarkup(items) {
    if (!items.length) return `<div class="empty-state"><strong>No medical records yet</strong><p>Uploads are stored in the private medical-records bucket.</p></div>`;
    return `<div class="doc-list">${items.map((record) => `<div class="doc-row" role="button" tabindex="0" data-cloud-record="${escapeHtml(record.id)}"><div class="doc-type">▤</div><div class="doc-info"><strong>${escapeHtml(record.title)}</strong><small>${escapeHtml(record.member_name || selectedMember()?.display_name)} · ${escapeHtml(dateLabel(record.document_date))}</small></div><span class="status ${record.verification_status === "user_confirmed" ? "status-reviewed" : "status-pending"}">${escapeHtml(record.verification_status)}</span></div>`).join("")}</div>`;
  }

  function renderFamily() {
    return `${cloudHeading("YOUR CARE CIRCLE", "Family members", "Patient profiles and access-controlled records.", `<button class="btn btn-primary" data-cloud-action="add-member">＋ Add dependent</button>`)}<div class="member-grid" style="margin-top:20px">${members.map((m) => `<article class="card person-card"><div class="person-head"><div class="avatar">${escapeHtml(m.initials)}</div><div><strong>${escapeHtml(m.display_name)}</strong><small>${escapeHtml(m.relationship)}</small></div></div><div class="person-detail"><span>Medical records</span><b>${m.record_count}</b></div><div class="person-detail"><span>Latest activity</span><b>${escapeHtml(m.latest_event)}</b></div><button class="btn btn-sm" data-cloud-select="${escapeHtml(m.id)}">View patient records →</button>${m.is_dependent ? `<button class="btn btn-sm" data-cloud-archive-member="${escapeHtml(m.id)}">Archive profile</button>` : ""}</article>`).join("") || `<div class="empty-state">No patient profiles are available.</div>`}</div>`;
  }

  function renderVault() {
    const items = selectedRecords().sort((a, b) => String(b.document_date || b.created_at).localeCompare(String(a.document_date || a.created_at)));
    return `${cloudHeading("YOUR RECORDS", "Medical vault", "Searchable records from your authenticated family workspace.", `<button class="btn btn-primary" data-cloud-action="upload">＋ Upload record</button>`)}<div class="page-toolbar">${memberSelect()}<input class="filter-search" id="cloudRecordSearch" placeholder="Search records" aria-label="Search records"></div><div id="cloudRecords">${recordsMarkup(items)}</div>`;
  }

  function renderTimeline() {
    const events = timeline.filter((event) => !memberId || event.member_id === memberId);
    return `${cloudHeading("CARE HISTORY", "Health timeline", "Chronological records and user-entered events. No clinical interpretation is generated.") }<div class="row-between" style="margin:18px 0">${memberSelect()}</div><section class="card" style="padding:18px">${events.length ? `<div class="doc-list">${events.map((event) => `<div class="doc-row"><div class="doc-type">◷</div><div class="doc-info"><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(dateLabel(event.event_date))} · ${escapeHtml(event.event_type)}</small></div><span class="status status-pending">${escapeHtml(event.verification_status || "unverified")}</span></div>`).join("")}</div>` : `<div class="empty-state"><strong>No timeline events</strong><p>Events appear when records or other supported entries are added.</p></div>`}</section>`;
  }

  function renderMedications() {
    const items = selectedMeds();
    return `${cloudHeading("DAILY CARE", "Medications", "Stored medication details and dose logs. Background notifications are not configured.", `<button class="btn btn-primary" data-cloud-action="add-medication">＋ Add medication</button>`)}<div class="row-between" style="margin:18px 0">${memberSelect()}</div><section class="card" style="padding:18px">${items.length ? `<div class="doc-list">${items.map((med) => `<div class="doc-row"><div class="doc-type">✳</div><div class="doc-info"><strong>${escapeHtml(med.medicine_name)}</strong><small>${escapeHtml(med.strength || "")}${med.dosage_instructions ? ` · ${escapeHtml(med.dosage_instructions)}` : ""} · ${escapeHtml(med.frequency || "No schedule recorded")}</small></div><span class="status status-pending">${escapeHtml(med.status)}</span><button class="btn btn-sm" data-cloud-dose="${escapeHtml(med.id)}">Log dose</button><button class="btn btn-sm" data-cloud-history="${escapeHtml(med.id)}">Dose history</button></div>`).join("")}</div>` : `<div class="empty-state"><strong>No medications recorded</strong><p>Only enter medication details from a trusted source.</p></div>`}</section>`;
  }

  function renderShares() {
    return `${cloudHeading("CONTROLLED ACCESS", "Emergency sharing", "Create time-limited, scope-limited links. This view does not generate a QR image.", `<button class="btn btn-primary" data-cloud-action="create-share">＋ Create share link</button>`)}<section class="card" style="padding:18px;margin-top:18px">${shares.length ? `<div class="doc-list">${shares.map((share) => `<div class="doc-row"><div class="doc-info"><strong>${escapeHtml(share.share_scope)}</strong><small>${escapeHtml(share.member_id)} · Expires ${escapeHtml(new Date(share.expires_at).toLocaleString())}</small></div><span class="status ${share.revoked_at ? "status-archived" : "status-reviewed"}">${share.revoked_at ? "Revoked" : "Active"}</span>${!share.revoked_at ? `<button class="btn btn-sm" data-cloud-revoke="${escapeHtml(share.id)}">Revoke</button>` : ""}</div>`).join("")}</div>` : `<div class="empty-state"><strong>No active share links</strong><p>Links are authorized by the share token and expire automatically.</p></div>`}</section>`;
  }

  function renderSettings() {
    return `${cloudHeading("ACCOUNT", "Settings", "Manage your profile and sign-in session.")}<section class="card" style="padding:18px;margin-top:18px"><form id="cloudProfileForm"><label class="field">Display name<input id="cloudDisplayName" maxlength="120" required value="${escapeHtml(profile?.display_name || "")}"></label><button class="btn btn-primary" type="submit">Save profile</button></form><button class="btn" style="margin-top:14px" data-cloud-action="signout">Sign out</button></section>`;
  }

  function renderCloud(view = "overview") {
    activeView = view;
    const titles = { overview: "Overview", family: "Family members", vault: "Medical vault", timeline: "Health timeline", medications: "Medications", emergency: "Emergency sharing", settings: "Settings", labs: "Labs & care", landing: "Workspace" };
    document.getElementById("currentCrumb").textContent = titles[view] || "Overview";
    document.querySelectorAll(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    document.querySelector(".crumb span").textContent = "Private workspace";
    const page = document.getElementById("pageContent");
    const footer = document.querySelector(".app-footer span:last-child");
    if (footer) footer.textContent = cloudError ? "Signed in · Private workspace unavailable" : "Signed in · Data loaded from MediVault APIs";
    const sidebarName = document.querySelector(".sidebar-profile strong");
    const sidebarRole = document.querySelector(".sidebar-profile small");
    if (sidebarName) sidebarName.textContent = profile?.display_name || "Signed-in user";
    if (sidebarRole) sidebarRole.textContent = profile?.email || "Authenticated account";
    const topProfile = document.getElementById("topProfile");
    if (topProfile) {
      topProfile.textContent = (profile?.display_name || profile?.email || "U").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
      topProfile.setAttribute("aria-label", "Signed-in account · Open settings");
    }
    if (cloudError) page.innerHTML = cloudErrorView();
    else page.innerHTML = ({
      overview: renderOverview,
      family: renderFamily,
      vault: renderVault,
      timeline: renderTimeline,
      medications: renderMedications,
      emergency: renderShares,
      settings: renderSettings,
      labs: () => `${cloudHeading("CARE SERVICES", "Labs & care", "Live provider search and booking are not configured.")}<section class="card" style="padding:18px;margin-top:18px"><p>There are no verified provider integrations available in this workspace.</p></section>`,
      landing: renderOverview,
    }[view] || renderOverview)();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const legacyRender = render;
  render = function (view) {
    if (cloudMode) return renderCloud(view);
    const result = legacyRender(view);
    if (view === "auth") showAuthConfiguration(Boolean(backendStatus?.supabaseConfigured));
    return result;
  };

  async function authSubmit(form) {
    const submit = form.querySelector('[type="submit"]');
    const mode = document.querySelector("[data-mv-auth-mode].selected")?.dataset.mvAuthMode || "signin";
    const email = document.getElementById("mvEmail")?.value.trim();
    const password = document.getElementById("mvPassword")?.value;
    if (!email || !password) return;
    submit.disabled = true;
    const oldLabel = submit.textContent;
    submit.textContent = "Please wait…";
    try {
      const result = await api("/api/auth/email", { method: "POST", body: JSON.stringify({ mode, email, password, ...(mode === "signup" ? { displayName: email.split("@")[0] } : {}) }) });
      if (result.verificationRequired) notify("Check your email to verify your account before opening your private workspace.");
      else await enterCloudMode();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Sign-in could not be completed.");
    } finally {
      submit.disabled = false;
      submit.textContent = oldLabel;
    }
  }

  async function requestPasswordReset() {
    const email = document.getElementById("mvEmail")?.value.trim();
    if (!email) { notify("Enter your email address first."); document.getElementById("mvEmail")?.focus(); return; }
    try { notify((await api("/api/auth/reset", { method: "POST", body: JSON.stringify({ email }) })).message); }
    catch (error) { notify(error instanceof Error ? error.message : "Password reset could not be requested."); }
  }

  async function beginGoogleSignIn() {
    const button = document.getElementById("mvGoogle");
    if (button) button.disabled = true;
    try { const result = await api("/api/auth/google", { method: "POST", body: "{}" }); window.location.assign(result.url); }
    catch (error) { notify(error instanceof Error ? error.message : "Google sign-in is unavailable."); if (button) button.disabled = false; }
  }

  function modal(title, description, body, submitLabel, action) {
    openModal(`<div class="eyebrow">MEDIVAULT · PRIVATE WORKSPACE</div><h2>${escapeHtml(title)}</h2><p class="modal-description">${escapeHtml(description)}</p><form id="cloudModalForm">${body}<div class="modal-actions"><button type="button" class="btn" data-dismiss>Cancel</button><button type="submit" class="btn btn-primary">${escapeHtml(submitLabel)}</button></div></form>`);
    document.getElementById("cloudModalForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const followUp = await action(new FormData(event.currentTarget));
        closeModal();
        await loadWorkspace();
        renderCloud(activeView);
        if (typeof followUp === "string") showShareLink(followUp);
      }
      catch (error) { notify(error instanceof Error ? error.message : "The request could not be completed."); button.disabled = false; }
    });
  }

  function uploadDialog() {
    const options = members.map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === memberId ? "selected" : ""}>${escapeHtml(m.display_name)}</option>`).join("");
    const categories = ["Prescription / medication", "Laboratory report", "Imaging / diagnostic report", "Diagnosis / illness", "Hospitalization / discharge", "Vaccination", "Allergies", "Doctor visit / follow-up", "Other medical document"];
    modal("Upload a medical record", "The original file is stored in the private medical-records bucket. OCR is not configured.", `<label class="field">Record name<input name="title" maxlength="160" required></label><label class="field">Patient<select name="memberId" required>${options}</select></label><label class="field">Category<select name="category">${categories.map((value) => `<option>${escapeHtml(value)}</option>`).join("")}</select></label><label class="field">Document date<input name="documentDate" type="date" max="${new Date().toISOString().slice(0, 10)}"></label><label class="field">Notes<textarea name="notes" maxlength="4000"></textarea></label><label class="field">PDF or image<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required></label>`, "Upload record", async (form) => {
      const member = String(form.get("memberId"));
      const body = new FormData();
      for (const key of ["title", "category", "documentDate", "notes", "file"]) if (form.get(key)) body.set(key, form.get(key));
      await api(`/api/members/${encodeURIComponent(member)}/records`, { method: "POST", body });
    });
  }

  function addMemberDialog() {
    modal("Add a dependent profile", "Adult profiles require a separate consent and account-linking flow.", `<label class="field">Full name<input name="displayName" maxlength="120" required></label><label class="field">Relationship<input name="relationship" maxlength="40" required></label><label class="field">Date of birth<input name="dateOfBirth" type="date" max="${new Date().toISOString().slice(0, 10)}"></label>`, "Add profile", async (form) => {
      await api(`/api/families/${encodeURIComponent(familyId)}/members`, { method: "POST", body: JSON.stringify({ displayName: form.get("displayName"), relationship: form.get("relationship"), ...(form.get("dateOfBirth") ? { dateOfBirth: form.get("dateOfBirth") } : {}), isDependent: true }) });
    });
  }

  function medicationDialog() {
    modal("Add medication details", "Enter details exactly as shown on the prescription. This does not schedule background notifications.", `<label class="field">Patient<select name="memberId">${members.map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === memberId ? "selected" : ""}>${escapeHtml(m.display_name)}</option>`).join("")}</select></label><label class="field">Medication name<input name="medicineName" maxlength="160" required></label><label class="field">Strength<input name="strength" maxlength="100"></label><label class="field">Dosage instructions<input name="dosageInstructions" maxlength="500"></label><label class="field">Route<input name="route" maxlength="60"></label><label class="field">Frequency or schedule<input name="frequency" maxlength="120"></label><label class="field">Start date<input name="startDate" type="date"></label><label class="field">End date<input name="endDate" type="date"></label>`, "Save medication", async (form) => {
      const member = String(form.get("memberId"));
      const medication = Object.fromEntries([...form.entries()].filter(([key, value]) => key !== "memberId" && value !== ""));
      await api(`/api/members/${encodeURIComponent(member)}/medications`, { method: "POST", body: JSON.stringify(medication) });
    });
  }

  function shareDialog() {
    const patient = selectedMember();
    if (!patient) { notify("Select a patient first."); return; }
    const choices = records.filter((record) => record.member_id === patient.id);
    modal("Create a time-limited share", "Emergency summary links include only records you select. The link itself contains an opaque, high-entropy token.", `<div class="field"><span>Patient</span><strong>${escapeHtml(patient.display_name)}</strong><input type="hidden" name="memberId" value="${escapeHtml(patient.id)}"></div><label class="field">Scope<select name="scope"><option value="emergency_summary">Emergency summary</option><option value="full_history">Full history snapshot</option></select></label><label class="field">Expires in hours<input name="expiresInHours" type="number" min="1" max="168" value="24" required></label><label class="field">Emergency records<select name="recordIds" multiple size="5">${choices.map((record) => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.title)}</option>`).join("")}</select><small>For full history, all current non-archived records are snapshotted.</small></label>`, "Create share", async (form) => {
      const selected = [...document.querySelector('[name="recordIds"]').selectedOptions].map((option) => option.value);
      const result = await api("/api/shares", { method: "POST", body: JSON.stringify({ memberId: form.get("memberId"), scope: form.get("scope"), expiresInHours: Number(form.get("expiresInHours")), recordIds: selected }) });
      return result.share.url;
    });
  }

  function showShareLink(url) {
    openModal(`<div class="eyebrow">SHARE CREATED</div><h2>Copy your secure link</h2><p class="modal-description">The raw share token is shown only in this response. Keep the link private.</p><label class="field">Share link<input id="cloudShareUrl" readonly value="${escapeHtml(url)}"></label><div class="modal-actions"><button type="button" class="btn btn-primary" id="copyCloudShare">Copy link</button><button type="button" class="btn" data-dismiss>Done</button></div>`);
    document.getElementById("copyCloudShare").addEventListener("click", async () => { await navigator.clipboard.writeText(url); notify("Share link copied."); });
  }

  async function openRecord(recordId) {
    try {
      const result = await api(`/api/records/${encodeURIComponent(recordId)}`);
      openModal(`<div class="eyebrow">${escapeHtml(result.record.category)} · ${escapeHtml(dateLabel(result.record.document_date))}</div><h2>${escapeHtml(result.record.title)}</h2><p class="modal-description">${escapeHtml(result.record.member_id === memberId ? selectedMember()?.display_name : "Family member")} · ${escapeHtml(result.record.verification_status)}</p><p>${escapeHtml(result.record.notes || "No notes recorded.")}</p><div class="modal-actions"><a class="btn btn-primary" href="${escapeHtml(result.previewUrl)}" target="_blank" rel="noopener noreferrer">Open private document</a><button type="button" class="btn" data-cloud-archive-record="${escapeHtml(recordId)}">Archive</button></div>`);
    } catch (error) { notify(error instanceof Error ? error.message : "Record is unavailable."); }
  }

  async function handleCloudClick(event) {
    if (event.target.closest("#profileMenu") || event.target.closest("#topProfile")) {
      event.preventDefault(); event.stopImmediatePropagation(); renderCloud("settings"); return;
    }
    if (event.target.closest("#notifications")) {
      event.preventDefault(); event.stopImmediatePropagation(); notify("Notifications are not configured for this workspace."); return;
    }
    const view = event.target.closest("[data-view]");
    if (view) { event.preventDefault(); event.stopImmediatePropagation(); closeModalIfOpen(); renderCloud(view.dataset.view); document.getElementById("sidebar").classList.remove("open"); return; }
    const action = event.target.closest("[data-cloud-action]");
    if (action) {
      event.preventDefault(); event.stopImmediatePropagation();
      try {
        switch (action.dataset.cloudAction) {
          case "upload": uploadDialog(); break;
          case "add-member": addMemberDialog(); break;
          case "add-medication": medicationDialog(); break;
          case "create-share": shareDialog(); break;
          case "refresh": await enterCloudMode(); break;
          case "signout": await signOut(); break;
        }
      } catch (error) { notify(error instanceof Error ? error.message : "The request could not be completed."); }
      return;
    }
    const record = event.target.closest("[data-cloud-record]");
    if (record) { event.preventDefault(); event.stopImmediatePropagation(); await openRecord(record.dataset.cloudRecord); return; }
    const patient = event.target.closest("[data-cloud-select]");
    if (patient) { event.preventDefault(); event.stopImmediatePropagation(); memberId = patient.dataset.cloudSelect; renderCloud("vault"); return; }
    const archiveMember = event.target.closest("[data-cloud-archive-member]");
    if (archiveMember) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!confirm("Archive this dependent profile? Its records will be retained.")) return;
      try { await api(`/api/members/${encodeURIComponent(archiveMember.dataset.cloudArchiveMember)}`, { method: "PATCH", body: JSON.stringify({ archive: true }) }); await loadWorkspace(); renderCloud("family"); }
      catch (error) { notify(error instanceof Error ? error.message : "Profile could not be archived."); }
      return;
    }
    const archiveRecord = event.target.closest("[data-cloud-archive-record]");
    if (archiveRecord) {
      event.preventDefault(); event.stopImmediatePropagation();
      try { await api(`/api/records/${encodeURIComponent(archiveRecord.dataset.cloudArchiveRecord)}`, { method: "PATCH", body: JSON.stringify({ archive: true }) }); closeModal(); await loadWorkspace(); renderCloud("vault"); notify("Record archived."); }
      catch (error) { notify(error instanceof Error ? error.message : "Record could not be archived."); }
      return;
    }
    const revoke = event.target.closest("[data-cloud-revoke]");
    if (revoke) {
      event.preventDefault(); event.stopImmediatePropagation();
      try { await api(`/api/shares/${encodeURIComponent(revoke.dataset.cloudRevoke)}`, { method: "DELETE" }); await loadWorkspace(); renderCloud("emergency"); notify("Share revoked."); }
      catch (error) { notify(error instanceof Error ? error.message : "Share could not be revoked."); }
      return;
    }
    const dose = event.target.closest("[data-cloud-dose]");
    if (dose) { event.preventDefault(); event.stopImmediatePropagation(); doseDialog(dose.dataset.cloudDose); return; }
    const history = event.target.closest("[data-cloud-history]");
    if (history) {
      event.preventDefault(); event.stopImmediatePropagation();
      try { const result = await api(`/api/medications/${encodeURIComponent(history.dataset.cloudHistory)}/doses`); openModal(`<div class="eyebrow">MEDICATION HISTORY</div><h2>Dose logs</h2>${result.doses.length ? `<div class="doc-list">${result.doses.map((log) => `<div class="doc-row"><div class="doc-info"><strong>${escapeHtml(log.status)}</strong><small>${escapeHtml(new Date(log.scheduled_at).toLocaleString())}</small></div></div>`).join("")}</div>` : `<p class="modal-description">No dose logs have been recorded.</p>`}`); }
      catch (error) { notify(error instanceof Error ? error.message : "Dose history is unavailable."); }
    }
  }

  function closeModalIfOpen() { if (typeof dialog !== "undefined" && dialog.open) closeModal(); }

  function doseDialog(medicationId) {
    modal("Record a dose", "This records the status you select. It does not infer missed doses or run background reminders.", `<label class="field">Scheduled date and time<input name="scheduledAt" type="datetime-local" required value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></label><label class="field">Status<select name="status"><option value="taken">Taken</option><option value="skipped">Skipped</option><option value="missed">Missed</option></select></label><label class="field">Notes<input name="notes" maxlength="500"></label>`, "Save dose log", async (form) => {
      const scheduledAt = new Date(String(form.get("scheduledAt"))).toISOString();
      await api(`/api/medications/${encodeURIComponent(medicationId)}/doses`, { method: "POST", body: JSON.stringify({ scheduledAt, status: form.get("status"), ...(form.get("notes") ? { notes: form.get("notes") } : {}) }) });
    });
  }

  async function signOut() {
    await api("/api/auth/signout", { method: "POST", body: "{}" });
    window.location.reload();
  }

  document.addEventListener("click", (event) => { if (cloudMode) void handleCloudClick(event); }, true);
  document.addEventListener("change", (event) => {
    if (!cloudMode) return;
    const select = event.target.closest("#cloudMember");
    if (select) { event.stopImmediatePropagation(); memberId = select.value; renderCloud(activeView); }
  }, true);
  document.addEventListener("input", (event) => {
    if (!cloudMode || event.target.id !== "cloudRecordSearch") return;
    const query = event.target.value.toLocaleLowerCase();
    const matches = selectedRecords().filter((record) => `${record.title} ${record.category} ${record.member_name}`.toLocaleLowerCase().includes(query));
    const container = document.getElementById("cloudRecords");
    if (container) container.innerHTML = recordsMarkup(matches);
  }, true);
  document.addEventListener("submit", async (event) => {
    if (!cloudMode || event.target.id !== "cloudProfileForm") return;
    event.preventDefault(); event.stopImmediatePropagation();
    try {
      profile = (await api("/api/profile", { method: "PATCH", body: JSON.stringify({ displayName: document.getElementById("cloudDisplayName").value }) })).profile;
      notify("Profile saved.");
    } catch (error) { notify(error instanceof Error ? error.message : "Profile could not be saved."); }
  }, true);

  window.MediVaultBackend = { authSubmit, requestPasswordReset, beginGoogleSignIn };
  fetch("/api/status", { credentials: "same-origin", cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then(async (status) => {
      if (!status) return;
      backendStatus = status;
      showAuthConfiguration(status.supabaseConfigured);
      if (!status.supabaseConfigured) return;
      const session = await api("/api/auth/session");
      if (session.authenticated) await enterCloudMode();
    })
    .catch(() => {});
})();
