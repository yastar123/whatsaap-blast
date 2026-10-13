import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

if (process.env.NODE_ENV === "production") {
  throw new Error("Smoke tests with database writes are disabled in production.");
}

const apiBase = process.env.API_BASE_URL ?? "http://localhost:8080/api";
const webBase = process.env.WEB_BASE_URL ?? "http://localhost:24356";
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(apiBase)) {
  throw new Error("API_BASE_URL must point to a local development server.");
}

const demoPassword = process.env.SEED_DEMO_PASSWORD ?? "DemoOnly2026!";
const suffix = randomUUID();
const testEmail = `qa-${suffix}@example.invalid`;
const testPassword = `Qa-${suffix}-T8!`;
const campaignTitle = `QA smoke campaign ${suffix}`;
const failures = [];
const created = { userId: null, campaignId: null, sessionId: null };
const issuedTokens = [];

function check(name, passed, detail = "") {
  if (passed) {
    console.log(`PASS ${name}`);
  } else {
    const failure = detail ? `${name}: ${detail}` : name;
    failures.push(failure);
    console.error(`FAIL ${failure}`);
  }
}

async function request(path, { method = "GET", token, body } = {}) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { status: response.status, data, headers: response.headers };
}

function expectStatus(name, response, expected) {
  check(
    name,
    response.status === expected,
    `expected HTTP ${expected}; received ${response.status}`,
  );
}

async function assertPageRoutes() {
  const paths = [
    "/",
    "/login",
    "/register",
    "/whatsapp",
    "/blast",
    "/results",
    "/wallet",
    "/referrals",
    "/withdrawals",
    "/campaigns",
    "/contacts",
    "/customers",
    "/admin/sessions",
    "/settings",
  ];
  for (const path of paths) {
    try {
      const response = await fetch(`${webBase}${path}`);
      expectStatus(`web route ${path}`, response, 200);
      const html = await response.text();
      check(`web shell ${path}`, html.includes("<div") || html.includes("<html"));
    } catch (error) {
      check(`web route ${path}`, false, error instanceof Error ? error.message : String(error));
    }
  }
}

async function apiTests() {
  const health = await request("/healthz");
  expectStatus("public API health", health, 200);

  const unauthenticated = await request("/auth/me");
  expectStatus("authentication required", unauthenticated, 401);

  const invalidLogin = await request("/auth/login", {
    method: "POST",
    body: { email: "not-a-user@example.invalid", password: "invalid-password" },
  });
  expectStatus("invalid login rejected", invalidLogin, 401);

  const adminLogin = await request("/auth/login", {
    method: "POST",
    body: { email: "admin@demo.local", password: demoPassword },
  });
  expectStatus("demo admin login", adminLogin, 200);
  if (!adminLogin.data?.accessToken || !adminLogin.data?.user?.id) {
    throw new Error("Demo admin login did not return an authenticated user.");
  }
  const admin = adminLogin.data;
  issuedTokens.push(admin.accessToken);
  const adminMe = await request("/auth/me", { token: admin.accessToken });
  expectStatus("admin profile", adminMe, 200);
  check("admin role returned", adminMe.data?.role === "admin");

  const invalidRegistration = await request("/auth/register", {
    method: "POST",
    body: { name: "Q", email: "bad-email", password: "short" },
  });
  expectStatus("invalid registration rejected", invalidRegistration, 400);

  const registration = await request("/auth/register", {
    method: "POST",
    body: {
      name: "QA Smoke User",
      email: testEmail,
      password: testPassword,
      referralCode: admin.user.referralCode,
    },
  });
  expectStatus("customer registration with referral", registration, 201);
  if (!registration.data?.accessToken || !registration.data?.user?.id) {
    throw new Error("Customer registration did not return an authenticated user.");
  }
  const customer = registration.data;
  created.userId = customer.user.id;
  issuedTokens.push(customer.accessToken);

  const referralCheck = await pool.query(
    "SELECT referred_by FROM users WHERE id = $1",
    [created.userId],
  );
  check(
    "registration links the referral owner",
    referralCheck.rows[0]?.referred_by === admin.user.id,
  );

  const duplicateRegistration = await request("/auth/register", {
    method: "POST",
    body: {
      name: "QA Smoke User",
      email: testEmail,
      password: testPassword,
    },
  });
  expectStatus("duplicate registration rejected", duplicateRegistration, 409);

  const customerMe = await request("/auth/me", { token: customer.accessToken });
  expectStatus("customer profile", customerMe, 200);
  check("customer role returned", customerMe.data?.role === "customer");

  const refreshed = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken: customer.refreshToken },
  });
  expectStatus("refresh token rotation", refreshed, 200);
  if (refreshed.data?.accessToken && refreshed.data?.refreshToken) {
    customer.accessToken = refreshed.data.accessToken;
    customer.refreshToken = refreshed.data.refreshToken;
    issuedTokens.push(customer.accessToken);
  }
  const reusedRefresh = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken: registration.data.refreshToken },
  });
  expectStatus("old refresh token cannot be reused", reusedRefresh, 401);

  const adminReads = [
    ["admin campaign list", "/admin/campaigns"],
    ["admin contact list", "/admin/contacts?page=1&pageSize=20"],
    ["admin customer list", "/admin/users"],
    ["admin WhatsApp session list", "/admin/wa-sessions"],
    ["admin settings", "/admin/settings"],
  ];
  for (const [name, path] of adminReads) {
    const response = await request(path, { token: admin.accessToken });
    expectStatus(name, response, 200);
  }

  const settings = await request("/admin/settings", { token: admin.accessToken });
  check(
    "business settings match the configured defaults",
    settings.data?.perMessage === 1100 &&
      settings.data?.referralBonus === 60 &&
      settings.data?.minimumWithdrawal === 15000 &&
      settings.data?.sessionIdleMinutes === 10,
  );

  const customerReads = [
    ["customer dashboard", "/dashboard/overview"],
    ["active campaign", "/campaigns/active"],
    ["customer WhatsApp sessions", "/wa-sessions"],
    ["current blast", "/blast/current"],
    ["results page", "/results?page=1&pageSize=20"],
    ["results summary", "/results/summary"],
    ["campaign result summaries", "/results/campaigns"],
    ["wallet", "/wallet"],
    ["referrals", "/referrals"],
    ["withdrawals", "/withdrawals"],
  ];
  for (const [name, path] of customerReads) {
    const response = await request(path, { token: customer.accessToken });
    expectStatus(name, response, 200);
  }

  const customerAdminReads = [
    ["customer blocked from admin campaign list", "/admin/campaigns"],
    ["customer blocked from admin contacts", "/admin/contacts"],
    ["customer blocked from admin users", "/admin/users"],
    ["customer blocked from admin sessions", "/admin/wa-sessions"],
    ["customer blocked from admin settings", "/admin/settings"],
  ];
  for (const [name, path] of customerAdminReads) {
    const response = await request(path, { token: customer.accessToken });
    expectStatus(name, response, 403);
  }
  for (const [name, path] of [
    ["admin cannot read customer WhatsApp sessions", "/wa-sessions"],
    ["admin cannot read customer blast state", "/blast/current"],
  ]) {
    const response = await request(path, { token: admin.accessToken });
    expectStatus(name, response, 403);
  }

  const adminStart = await request("/blast/start", {
    method: "POST",
    token: admin.accessToken,
    body: { delaySeconds: 1 },
  });
  expectStatus("admin cannot start a customer blast", adminStart, 403);
  const invalidDelay = await request("/blast/start", {
    method: "POST",
    token: customer.accessToken,
    body: { delaySeconds: 3 },
  });
  expectStatus("unsupported blast delay rejected", invalidDelay, 400);
  const noSessionStart = await request("/blast/start", {
    method: "POST",
    token: customer.accessToken,
    body: { delaySeconds: 1 },
  });
  expectStatus("blast without an active campaign or session is blocked", noSessionStart, 409);
  const cancelEmpty = await request("/blast/cancel", {
    method: "POST",
    token: customer.accessToken,
  });
  expectStatus("cancel with no current blast is safe", cancelEmpty, 200);

  const adminWithdrawal = await request("/withdrawals", {
    method: "POST",
    token: admin.accessToken,
    body: {
      amount: 15000,
      method: "bank",
      accountName: "QA Admin",
      accountNumber: "123456789",
    },
  });
  expectStatus("admin cannot request a customer withdrawal", adminWithdrawal, 403);

  const invalidPageSize = await request("/admin/contacts?page=1&pageSize=101", {
    token: admin.accessToken,
  });
  expectStatus("contact pagination bounds enforced", invalidPageSize, 400);

  const badCampaign = await request("/admin/campaigns", {
    method: "POST",
    token: admin.accessToken,
    body: { title: "x", messageText: "" },
  });
  expectStatus("invalid campaign rejected", badCampaign, 400);

  const campaign = await request("/admin/campaigns", {
    method: "POST",
    token: admin.accessToken,
    body: {
      title: campaignTitle,
      messageText: "QA only; not activated or sent.",
      imageUrl: null,
      ctaText: null,
      ctaUrl: null,
    },
  });
  expectStatus("admin creates a draft campaign", campaign, 201);
  if (campaign.status === 201 && campaign.data?.id) {
    created.campaignId = campaign.data.id;
    const updatedCampaign = await request(`/admin/campaigns/${created.campaignId}`, {
      method: "PATCH",
      token: admin.accessToken,
      body: { title: `${campaignTitle} updated`, messageText: "Updated QA copy." },
    });
    expectStatus("admin updates a draft campaign", updatedCampaign, 200);
    check("campaign update is visible", updatedCampaign.data?.title === `${campaignTitle} updated`);

    const invalidImport = await request("/admin/contacts", {
      method: "POST",
      token: admin.accessToken,
      body: {
        campaignId: created.campaignId,
        contacts: [
          {
            phone: "abcdefgh",
            consentSource: "QA integration",
            consentAt: new Date().toISOString(),
          },
          {
            phone: "6281000000000",
            consentSource: "QA integration",
            consentAt: "2999-01-01T00:00:00.000Z",
          },
        ],
      },
    });
    expectStatus("contact import rejects invalid or future-consent rows", invalidImport, 201);
    check(
      "contact import inserts no ineligible QA contacts",
      invalidImport.data?.added === 0 &&
        invalidImport.data?.invalid === 1 &&
        invalidImport.data?.consentMissing === 1,
    );
  }
  const missingActivation = await request(`/admin/campaigns/${randomUUID()}/activate`, {
    method: "POST",
    token: admin.accessToken,
  });
  expectStatus("activation of a missing campaign rejected", missingActivation, 404);

  const session = await request("/wa-sessions", {
    method: "POST",
    token: customer.accessToken,
    body: { label: `QA ${suffix.slice(0, 8)}` },
  });
  expectStatus("customer creates an unpaired WA session", session, 201);
  if (session.status === 201 && session.data?.id) {
    created.sessionId = session.data.id;
    const list = await request("/wa-sessions", { token: customer.accessToken });
    expectStatus("created WA session appears in customer list", list, 200);
    check("WA session list contains new session", list.data?.some((item) => item.id === created.sessionId));
    const adminList = await request("/admin/wa-sessions", { token: admin.accessToken });
    expectStatus("admin can see all customer sessions", adminList, 200);
    check("admin session list contains test owner's session", adminList.data?.some((item) => item.id === created.sessionId));

    const invalidConnect = await request(`/wa-sessions/${created.sessionId}/connect`, {
      method: "POST",
      token: customer.accessToken,
      body: { method: "invalid" },
    });
    expectStatus("invalid pairing method rejected before connection", invalidConnect, 400);
    const adminConnect = await request(`/wa-sessions/${created.sessionId}/connect`, {
      method: "POST",
      token: admin.accessToken,
      body: { method: "qr" },
    });
    expectStatus("admin cannot pair a customer WhatsApp session", adminConnect, 403);
    const deletedSession = await request(`/wa-sessions/${created.sessionId}`, {
      method: "DELETE",
      token: customer.accessToken,
    });
    expectStatus("customer deletes an unpaired WA session", deletedSession, 200);
    created.sessionId = null;
  }

  const missingCustomerSession = await request(`/wa-sessions/${randomUUID()}`, {
    method: "DELETE",
    token: customer.accessToken,
  });
  expectStatus("missing customer WA session returns 404", missingCustomerSession, 404);
  const missingAdminSession = await request(`/admin/wa-sessions/${randomUUID()}`, {
    method: "DELETE",
    token: admin.accessToken,
  });
  expectStatus("missing admin WA session returns 404", missingAdminSession, 404);

  const referralList = await request("/referrals", { token: admin.accessToken });
  expectStatus("referral owner can see the new downline", referralList, 200);
  check(
    "referral summary contains registered QA customer",
    referralList.data?.downlines?.some((item) => item.name === "QA Smoke User"),
  );

  const campaignSummaries = await request("/results/campaigns", {
    token: customer.accessToken,
  });
  expectStatus("customer campaign results remain scoped", campaignSummaries, 200);
  const invalidResultPage = await request("/results?page=0&pageSize=20", {
    token: customer.accessToken,
  });
  expectStatus("result pagination bounds enforced", invalidResultPage, 400);
  const csv = await fetch(`${apiBase}/results/export?format=csv`, {
    headers: { authorization: `Bearer ${customer.accessToken}` },
  });
  check("CSV export returns downloadable data", csv.status === 200 && (csv.headers.get("content-type") ?? "").includes("text/csv"));
  const csvText = await csv.text();
  check("CSV export includes the requested headers", csvText.toLowerCase().includes("phone") || csvText.toLowerCase().includes("nomor"));
  const xlsx = await fetch(`${apiBase}/results/export?format=xlsx`, {
    headers: { authorization: `Bearer ${customer.accessToken}` },
  });
  const xlsxBytes = await xlsx.arrayBuffer();
  check("Excel export returns a non-empty spreadsheet", xlsx.status === 200 && xlsxBytes.byteLength > 100);

  const blocked = await request(`/admin/users/${created.userId}/status`, {
    method: "PATCH",
    token: admin.accessToken,
    body: { status: "blocked" },
  });
  expectStatus("admin blocks a customer", blocked, 200);
  const blockedMe = await request("/auth/me", { token: customer.accessToken });
  expectStatus("blocked customer access is revoked", blockedMe, 403);
  const reactivated = await request(`/admin/users/${created.userId}/status`, {
    method: "PATCH",
    token: admin.accessToken,
    body: { status: "active" },
  });
  expectStatus("admin reactivates the customer", reactivated, 200);
  const reactivatedMe = await request("/auth/me", { token: customer.accessToken });
  expectStatus("reactivated customer can access account", reactivatedMe, 200);

  await testWithdrawalFlow(admin, customer);

  const deletedCampaign = created.campaignId
    ? await request(`/admin/campaigns/${created.campaignId}`, {
        method: "DELETE",
        token: admin.accessToken,
      })
    : null;
  if (deletedCampaign) {
    expectStatus("admin deletes the unused QA campaign", deletedCampaign, 200);
    created.campaignId = null;
  }

  const logout = await request("/auth/logout", {
    method: "POST",
    token: customer.accessToken,
  });
  expectStatus("customer logout", logout, 200);
  const revokedRefresh = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken: customer.refreshToken },
  });
  expectStatus("logged-out refresh token rejected", revokedRefresh, 401);
}

async function testWithdrawalFlow(admin, customer) {
  await pool.query("UPDATE users SET main_balance = 25000 WHERE id = $1", [customer.user.id]);
  const payload = {
    amount: 25000,
    method: "bank",
    accountName: "QA Smoke User",
    accountNumber: "123456789012",
  };

  const underMinimum = await request("/withdrawals", {
    method: "POST",
    token: customer.accessToken,
    body: { ...payload, amount: 14999 },
  });
  expectStatus("withdrawal below minimum rejected", underMinimum, 400);

  const concurrent = await Promise.all([
    request("/withdrawals", { method: "POST", token: customer.accessToken, body: payload }),
    request("/withdrawals", { method: "POST", token: customer.accessToken, body: payload }),
  ]);
  const succeeded = concurrent.filter((item) => item.status === 201);
  const rejected = concurrent.filter((item) => item.status === 400);
  check(
    "concurrent withdrawals reserve a balance only once",
    succeeded.length === 1 && rejected.length === 1,
    `expected one 201 and one 400; got ${concurrent.map((item) => item.status).join(",")}`,
  );
  if (succeeded.length !== 1 || !succeeded[0].data?.id) return;
  const rejectedWithdrawalId = succeeded[0].data.id;

  const customerWithdrawals = await request("/withdrawals", {
    token: customer.accessToken,
  });
  check(
    "customer withdrawal response masks account number",
    customerWithdrawals.status === 200 &&
      customerWithdrawals.data?.some(
        (item) => item.id === rejectedWithdrawalId && !("accountNumber" in item),
      ),
  );
  const adminWithdrawals = await request("/withdrawals", {
    token: admin.accessToken,
  });
  check(
    "admin withdrawal response contains transfer destination",
    adminWithdrawals.status === 200 &&
      adminWithdrawals.data?.some(
        (item) => item.id === rejectedWithdrawalId && item.accountNumber === payload.accountNumber,
      ),
  );

  const rejectWithoutReason = await request(`/admin/withdrawals/${rejectedWithdrawalId}`, {
    method: "PATCH",
    token: admin.accessToken,
    body: { status: "rejected" },
  });
  expectStatus("rejection requires an admin reason", rejectWithoutReason, 400);
  const customerReview = await request(`/admin/withdrawals/${rejectedWithdrawalId}`, {
    method: "PATCH",
    token: customer.accessToken,
    body: { status: "rejected", note: "not allowed" },
  });
  expectStatus("customer cannot review withdrawals", customerReview, 403);

  const rejectedWithdrawal = await request(`/admin/withdrawals/${rejectedWithdrawalId}`, {
    method: "PATCH",
    token: admin.accessToken,
    body: { status: "rejected", note: "QA refund check" },
  });
  expectStatus("admin rejects a pending withdrawal", rejectedWithdrawal, 200);
  const secondReject = await request(`/admin/withdrawals/${rejectedWithdrawalId}`, {
    method: "PATCH",
    token: admin.accessToken,
    body: { status: "rejected", note: "duplicate QA action" },
  });
  expectStatus("refund cannot be issued twice", secondReject, 400);

  const refundState = await pool.query(
    `SELECT u.main_balance,
            COUNT(t.id) FILTER (WHERE t.type = 'withdraw_refund' AND t.ref_id = $2) AS refunds
     FROM users u LEFT JOIN transactions t ON t.user_id = u.id
     WHERE u.id = $1 GROUP BY u.id`,
    [customer.user.id, rejectedWithdrawalId],
  );
  check(
    "rejected withdrawal refunds exactly once",
    Number(refundState.rows[0]?.main_balance) === 25000 &&
      Number(refundState.rows[0]?.refunds) === 1,
  );

  await pool.query("UPDATE users SET main_balance = 25000 WHERE id = $1", [customer.user.id]);
  const paidRequest = await request("/withdrawals", {
    method: "POST",
    token: customer.accessToken,
    body: { ...payload, amount: 15000 },
  });
  expectStatus("minimum withdrawal amount accepted", paidRequest, 201);
  if (!paidRequest.data?.id) return;

  const approved = await request(`/admin/withdrawals/${paidRequest.data.id}`, {
    method: "PATCH",
    token: admin.accessToken,
    body: { status: "approved", note: "QA transfer started" },
  });
  expectStatus("pending withdrawal moves to processing", approved, 200);
  const paid = await request(`/admin/withdrawals/${paidRequest.data.id}`, {
    method: "PATCH",
    token: admin.accessToken,
    body: { status: "paid", note: "QA transfer complete" },
  });
  expectStatus("processing withdrawal moves to paid", paid, 200);
  const paidAgain = await request(`/admin/withdrawals/${paidRequest.data.id}`, {
    method: "PATCH",
    token: admin.accessToken,
    body: { status: "rejected", note: "invalid transition" },
  });
  expectStatus("paid withdrawal cannot be changed", paidAgain, 400);

  const paidBalance = await pool.query(
    "SELECT main_balance FROM users WHERE id = $1",
    [customer.user.id],
  );
  check("paid withdrawal remains reserved", Number(paidBalance.rows[0]?.main_balance) === 10000);
}

async function cleanup() {
  if (created.sessionId && created.userId) {
    await pool.query(
      "DELETE FROM wa_sessions WHERE id = $1 AND user_id = $2",
      [created.sessionId, created.userId],
    );
  }
  if (created.campaignId) {
    await pool.query("DELETE FROM contacts WHERE campaign_id = $1", [created.campaignId]);
    await pool.query(
      "DELETE FROM campaigns WHERE id = $1 AND is_active = false AND sent_count = 0",
      [created.campaignId],
    );
  }
  if (created.userId) {
    await pool.query("DELETE FROM transactions WHERE user_id = $1", [created.userId]);
    await pool.query("DELETE FROM withdrawals WHERE user_id = $1", [created.userId]);
    await pool.query("DELETE FROM activity WHERE user_id = $1", [created.userId]);
    await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [created.userId]);
    await pool.query("DELETE FROM wa_sessions WHERE user_id = $1", [created.userId]);
    await pool.query("DELETE FROM blast_job_sessions WHERE blast_job_id IN (SELECT id FROM blast_jobs WHERE user_id = $1)", [created.userId]);
    await pool.query("DELETE FROM blast_jobs WHERE user_id = $1", [created.userId]);
    await pool.query("DELETE FROM users WHERE id = $1", [created.userId]);
  }
  for (const token of issuedTokens) {
    await request("/auth/logout", { method: "POST", token }).catch(() => undefined);
  }
}

try {
  await assertPageRoutes();
  await apiTests();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  console.error(`FAIL test run: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  try {
    await cleanup();
  } catch (error) {
    failures.push(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`FAIL cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }
  await pool.end();
}

console.log(`\nSmoke tests: ${failures.length ? "FAILED" : "PASSED"} (${failures.length} failures)`);
if (failures.length) process.exitCode = 1;
