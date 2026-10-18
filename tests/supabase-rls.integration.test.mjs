import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.MEDIVAULT_TEST_SUPABASE_URL;
const publishableKey = process.env.MEDIVAULT_TEST_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.MEDIVAULT_TEST_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && publishableKey && serviceRoleKey);

test("RLS blocks cross-family reads, storage access, membership escalation, and patient reassignment", {
  skip: !configured ? "requires an isolated Supabase project with the MediVault migration applied" : false,
}, async () => {
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = `${randomUUID()}-A9!`;
  const suffix = randomUUID();
  const users = [];
  const familyIds = new Set();
  const memberIds = new Set();
  let storagePath;

  try {
    for (const label of ["owner-a", "owner-b"]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `medivault-${label}-${suffix}@example.invalid`,
        password,
        email_confirm: true,
        user_metadata: { full_name: `Test ${label}` },
      });
      assert.ifError(error);
      users.push(data.user);
    }

    const [ownerA, ownerB] = users;
    const familyA = await admin.from("family_memberships").select("family_id").eq("user_id", ownerA.id).single();
    const memberA = await admin.from("family_members").select("id,family_id").eq("user_id", ownerA.id).single();
    const memberB = await admin.from("family_members").select("id,family_id").eq("user_id", ownerB.id).single();
    assert.ifError(familyA.error);
    assert.ifError(memberA.error);
    assert.ifError(memberB.error);
    familyIds.add(familyA.data.family_id);
    familyIds.add(memberB.data.family_id);
    memberIds.add(memberA.data.id);
    memberIds.add(memberB.data.id);

    const dependent = await admin.from("family_members").insert({
      family_id: memberA.data.family_id,
      display_name: "Synthetic Dependent",
      relationship: "Dependent",
      is_dependent: true,
      created_by: ownerA.id,
    }).select("id").single();
    assert.ifError(dependent.error);
    memberIds.add(dependent.data.id);

    const recordId = randomUUID();
    storagePath = `${memberA.data.family_id}/${memberA.data.id}/${recordId}/fixture.pdf`;
    const record = await admin.from("medical_records").insert({
      id: recordId,
      family_id: memberA.data.family_id,
      member_id: memberA.data.id,
      uploaded_by: ownerA.id,
      title: "Synthetic security fixture",
      category: "Other medical document",
      original_file_path: storagePath,
      original_filename: "fixture.pdf",
      detected_mime_type: "application/pdf",
      file_size_bytes: 5,
    });
    assert.ifError(record.error);
    const upload = await admin.storage.from("medical-records").upload(storagePath, new TextEncoder().encode("%PDF-"), {
      contentType: "application/pdf",
      upsert: false,
    });
    assert.ifError(upload.error);

    const clientA = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const clientB = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const anonymous = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signInA = await clientA.auth.signInWithPassword({ email: `medivault-owner-a-${suffix}@example.invalid`, password });
    const signInB = await clientB.auth.signInWithPassword({ email: `medivault-owner-b-${suffix}@example.invalid`, password });
    assert.ifError(signInA.error);
    assert.ifError(signInB.error);

    const familiesApi = await clientB.from("families").select("id").limit(1);
    assert.ifError(familiesApi.error, "the REST schema cache must recognize the families table");

    const anonymousPrivateRead = await anonymous.from("medical_records").select("id").eq("id", recordId).maybeSingle();
    assert.ok(anonymousPrivateRead.error || anonymousPrivateRead.data === null, "anonymous users must not read private medical records");

    const crossFamilyRead = await clientB.from("medical_records").select("id").eq("id", recordId).maybeSingle();
    assert.ifError(crossFamilyRead.error);
    assert.equal(crossFamilyRead.data, null);

    const crossFamilyProfile = await clientB.from("family_members").select("id").eq("id", memberA.data.id).maybeSingle();
    assert.ifError(crossFamilyProfile.error);
    assert.equal(crossFamilyProfile.data, null, "family membership alone must not expose another family's patient profile");

    const crossFamilyAuditWrite = await clientB.from("audit_events").insert({
      family_id: memberA.data.family_id,
      action: "security_test",
      resource_type: "synthetic_fixture",
    });
    assert.ok(crossFamilyAuditWrite.error, "an authenticated user must not write audit rows into another family");

    const crossMemberSource = await clientB.from("medical_conditions").insert({
      family_id: memberB.data.family_id,
      member_id: memberB.data.id,
      record_id: recordId,
      condition_name: "Synthetic cross-member reference test",
      source_type: "user_entered",
    });
    assert.ok(crossMemberSource.error, "a patient's condition must not reference another patient's record");

    const crossFamilyStorage = await clientB.storage.from("medical-records").createSignedUrl(storagePath, 30);
    assert.ok(crossFamilyStorage.error, "a different family must not receive a signed document URL");

    const escalation = await clientB.from("family_memberships").insert({ family_id: memberA.data.family_id, user_id: ownerB.id, role: "administrator" });
    assert.ok(escalation.error, "a user must not add themselves to another family");

    const reassignment = await clientA.from("medical_records").update({ member_id: dependent.data.id }).eq("id", recordId);
    assert.ok(reassignment.error, "record patient ownership must not be mutable");

    const ownRecord = await clientA.from("medical_records").select("id").eq("id", recordId).single();
    assert.ifError(ownRecord.error);
  } finally {
    if (storagePath) await admin.storage.from("medical-records").remove([storagePath]);
    if (users.length) {
      const ownedFamilies = await admin.from("families").select("id").in("created_by", users.map((user) => user.id));
      assert.ifError(ownedFamilies.error);
      for (const family of ownedFamilies.data || []) familyIds.add(family.id);
    }
    const familyIdList = [...familyIds];
    if (familyIdList.length) {
      const ownedMembers = await admin.from("family_members").select("id").in("family_id", familyIdList);
      assert.ifError(ownedMembers.error);
      for (const member of ownedMembers.data || []) memberIds.add(member.id);
    }
    const completeMemberIdList = [...memberIds];
    if (completeMemberIdList.length) {
      const cleanup = [
        await admin.from("share_sessions").delete().in("member_id", completeMemberIdList),
        await admin.from("share_session_documents").delete().in("member_id", completeMemberIdList),
        await admin.from("medical_records").delete().in("member_id", completeMemberIdList),
        await admin.from("medical_conditions").delete().in("member_id", completeMemberIdList),
        await admin.from("allergies").delete().in("member_id", completeMemberIdList),
        await admin.from("medication_dose_logs").delete().in("member_id", completeMemberIdList),
        await admin.from("medications").delete().in("member_id", completeMemberIdList),
        await admin.from("timeline_events").delete().in("member_id", completeMemberIdList),
        await admin.from("lab_bookings").delete().in("member_id", completeMemberIdList),
      ];
      for (const result of cleanup) assert.ifError(result.error);
    }
    if (familyIdList.length) {
      const deletedFamilies = await admin.from("families").delete().in("id", familyIdList);
      assert.ifError(deletedFamilies.error);
    }
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  }
});
