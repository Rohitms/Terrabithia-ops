import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const admin = "00000000-0000-4000-8000-000000000001";
const guest = "00000000-0000-4000-8000-000000000002";
const second = "00000000-0000-4000-8000-000000000003";
const unverified = "00000000-0000-4000-8000-000000000004";
let db: PGlite;
async function asUser(id: string, query: string) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`
  );
  try {
    return await db.query(query);
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}
async function access(id: string) {
  return (await asUser(id, "select * from public.get_my_access()")).rows;
}

describe("database authentication and authorization", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
    `);
    await db.exec(readFileSync("supabase/migrations/20261024140635_auth_foundation.sql", "utf8"));
    await db.exec(`
      insert into public.allowed_emails(email, role) values ('owner@example.com', 'admin');
      insert into auth.users(id, email, email_confirmed_at) values ('${admin}', 'Owner@Example.com', now());
      insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
      ('${guest}', 'guest@example.com', now(), '{"role":"admin","is_active":true}');
    `);
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });

  it("activates a verified, allow-listed account and normalizes its email", async () => {
    expect(await access(admin)).toMatchObject([
      { email: "owner@example.com", role: "admin", is_active: true },
    ]);
  });
  it("denies unlisted users despite spoofed user metadata", async () => {
    expect(await access(guest)).toEqual([]);
    expect((await asUser(guest, "select * from public.profiles")).rows).toMatchObject([
      { id: guest, role: "viewer", is_active: false },
    ]);
  });
  it("prevents anonymous reads and RPC access", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from public.profiles")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.get_my_access()")).rejects.toThrow(
        /permission denied/
      );
      await expect(
        db.query("select public.set_user_access('evil@example.com','admin',true)")
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
  it("prevents direct profile, allow-list and audit writes even by admins", async () => {
    for (const sql of [
      `update public.profiles set role = 'admin' where id = '${guest}'`,
      "insert into public.allowed_emails(email) values ('evil@example.com')",
      "delete from public.activity_log",
    ])
      await expect(asUser(admin, sql)).rejects.toThrow(/permission denied/);
  });
  it("denies access mutations by an unlisted user", async () => {
    await expect(
      asUser(guest, "select public.set_user_access('guest@example.com','admin',true)")
    ).rejects.toThrow(/Administrator access required/);
  });
  it("approves an already registered user and updates role for an existing session", async () => {
    await asUser(admin, "select public.set_user_access(' Guest@Example.com ','sales',true)");
    expect(await access(guest)).toMatchObject([{ role: "sales", is_active: true }]);
    expect((await asUser(guest, "select * from public.allowed_emails")).rows).toEqual([]);
    expect((await asUser(guest, "select * from public.activity_log")).rows).toEqual([]);
    await asUser(admin, "select public.set_user_access('guest@example.com','manager',true)");
    expect(await access(guest)).toMatchObject([{ role: "manager" }]);
    expect((await asUser(guest, "select * from public.activity_log")).rows.length).toBeGreaterThan(
      0
    );
    await expect(
      asUser(guest, "select public.set_user_access('guest@example.com','admin',true)")
    ).rejects.toThrow(/Administrator access required/);
  });
  it("revokes access immediately and does not reactivate on sign-in metadata refresh", async () => {
    await asUser(admin, "select public.set_user_access('guest@example.com','viewer',false)");
    expect(await access(guest)).toEqual([]);
    await db.exec(
      `update auth.users set raw_user_meta_data = '{"role":"admin","full_name":"Guest"}' where id = '${guest}'`
    );
    expect(await access(guest)).toEqual([]);
    expect((await asUser(guest, "select * from public.activity_log")).rows).toEqual([]);
  });
  it("protects the last admin and rolls back the change and its audit together", async () => {
    const before = (await db.query("select * from public.activity_log")).rows.length;
    for (const sql of [
      "select public.set_user_access('owner@example.com','viewer',true)",
      "select public.set_user_access('owner@example.com','admin',false)",
    ])
      await expect(asUser(admin, sql)).rejects.toThrow(/last active administrator/);
    expect(await access(admin)).toMatchObject([{ role: "admin", is_active: true }]);
    expect((await db.query("select * from public.activity_log")).rows).toHaveLength(before);
    await expect(
      db.exec("delete from public.allowed_emails where email='owner@example.com'")
    ).rejects.toThrow(/last active administrator/);
  });
  it("requires verified email, and activates after confirmation", async () => {
    await asUser(admin, "select public.set_user_access('unverified@example.com','sales',true)");
    await db.exec(
      `insert into auth.users(id,email) values ('${unverified}','unverified@example.com')`
    );
    expect(await access(unverified)).toEqual([]);
    await asUser(admin, "select public.set_user_access('unverified@example.com','manager',true)");
    expect(await access(unverified)).toEqual([]);
    await db.exec(`update auth.users set email_confirmed_at=now() where id='${unverified}'`);
    expect(await access(unverified)).toMatchObject([{ role: "manager", is_active: true }]);
  });
  it("drops access when the authenticated email changes to an unlisted email", async () => {
    await db.exec(`update auth.users set email='changed@example.com' where id='${unverified}'`);
    expect(await access(unverified)).toEqual([]);
  });
  it("does not duplicate audit events on no-op access updates", async () => {
    const before = (await db.query("select * from public.activity_log")).rows.length;
    await asUser(admin, "select public.set_user_access('owner@example.com','admin',true)");
    expect((await db.query("select * from public.activity_log")).rows).toHaveLength(before);
  });
  it("allows admin handover only after another active admin is present", async () => {
    await asUser(admin, "select public.set_user_access('second@example.com','admin',true)");
    await db.exec(
      `insert into auth.users(id,email,email_confirmed_at) values ('${second}','second@example.com',now())`
    );
    await asUser(admin, "select public.set_user_access('owner@example.com','viewer',false)");
    expect(await access(admin)).toEqual([]);
    expect(await access(second)).toMatchObject([{ role: "admin", is_active: true }]);
    await expect(
      asUser(admin, "select public.set_user_access('owner@example.com','admin',true)")
    ).rejects.toThrow(/Administrator access required/);
  });
});
