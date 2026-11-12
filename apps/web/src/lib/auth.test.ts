import { describe, expect, it, vi } from "vitest";
import type { Membership } from "@vetrix/db/runtime";
import type { StaffAccess } from "@vetrix/domain";
import { createAuthEmailSender } from "./auth-email";
import { createLogger } from "./logger";
import { resolveStaffContext, type StaffContextDeps } from "./staff-context";

const org = (id: string): Membership => ({ organization_id: id, organization_slug: id, organization_name: id });
const staff = (locations: number): StaffAccess => ({
  platformUserId: "u1",
  staffUserId: "s1",
  displayName: "Jo",
  locations: new Map(Array.from({ length: locations }, (_, i) => [`loc${i}`, new Set(["schedule.view" as const])])),
});

function deps(memberships: Membership[], access: StaffAccess | undefined): StaffContextDeps {
  return {
    memberships: vi.fn(async () => memberships),
    clinicFor: vi.fn(async (id: string) => ({ query: vi.fn(), connect: vi.fn(), id }) as never),
    loadAccess: vi.fn(async () => access),
  };
}

describe("staff context", () => {
  it("opens the only organization a person belongs to", async () => {
    const result = await resolveStaffContext(deps([org("a")], staff(1)), { userId: "u1" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.context.organization.organization_id).toBe("a");
  });

  it("asks people in several organizations to choose, unless the session already chose", async () => {
    const d = deps([org("a"), org("b")], staff(1));
    expect((await resolveStaffContext(d, { userId: "u1" })).status).toBe("choose_organization");
    const chosen = await resolveStaffContext(d, { userId: "u1", activeOrganizationId: "b" });
    expect(chosen.status === "ok" && chosen.context.organization.organization_id).toBe("b");
  });

  it("never opens an organization the person was removed from", async () => {
    const result = await resolveStaffContext(deps([org("a"), org("b")], staff(1)), {
      userId: "u1",
      activeOrganizationId: "gone",
    });
    expect(result.status).toBe("choose_organization");
  });

  it("refuses people with no membership, no staff record or no location roles", async () => {
    expect((await resolveStaffContext(deps([], staff(1)), { userId: "u1" })).status).toBe("no_access");
    expect((await resolveStaffContext(deps([org("a")], undefined), { userId: "u1" })).status).toBe("no_access");
    expect((await resolveStaffContext(deps([org("a")], staff(0)), { userId: "u1" })).status).toBe("no_access");
  });
});

describe("sign-in emails", () => {
  const quiet = createLogger({}, "error", () => undefined);
  const email = { to: "jo@example.com", subject: "Set your Vetrix password", text: "link", link: "https://x/reset" };

  it("sends through SendGrid without click tracking when configured", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const send = createAuthEmailSender(
      { NODE_ENV: "production", SENDGRID_API_KEY: "sg", EMAIL_FROM: "desk@example.com" },
      quiet,
      fetchImpl as typeof fetch,
    );
    await send(email);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.personalizations[0].to[0].email).toBe("jo@example.com");
    expect(body.tracking_settings.click_tracking.enable).toBe(false);
  });

  it("reports a SendGrid failure instead of pretending it was sent", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const send = createAuthEmailSender(
      { NODE_ENV: "development", SENDGRID_API_KEY: "sg", EMAIL_FROM: "desk@example.com" },
      quiet,
      fetchImpl as typeof fetch,
    );
    await expect(send(email)).rejects.toThrow(/Could not send/);
  });

  it("never prints links in production", () => {
    expect(() => createAuthEmailSender({ NODE_ENV: "production", SENDGRID_API_KEY: undefined, EMAIL_FROM: undefined }, quiet)).toThrow(/required in production/);
  });
});
