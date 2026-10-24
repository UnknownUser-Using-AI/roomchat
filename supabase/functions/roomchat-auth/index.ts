import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const allowedOrigins = new Set([
  "https://xlg77.github.io",
  "https://unknownuser-using-ai.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);
const encoder = new TextEncoder();
const ADMIN_INITIAL_NAMES = new Set(["천사", "크리스탈"]);

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const publicAuth = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalizeNickname(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFC").trim().replace(/\s+/gu, " ")
    : "";
}

function jsonResponse(body: unknown, status = 200, origin?: string | null): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-headers", "apikey, authorization, content-type, x-client-info");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function hmacIp(ip: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(serviceKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(ip)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function allowRequest(request: Request, bucket: "register" | "login"): Promise<boolean> {
  // Cloudflare overwrites this header at the edge; never trust caller-controlled X-Forwarded-For.
  const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown-client";
  const { data, error } = await admin.rpc("roomchat_consume_rate_limit", {
    p_key_hash: await hmacIp(ip),
    p_bucket: bucket,
    p_limit: bucket === "register" ? 5 : 20,
    p_window_seconds: bucket === "register" ? 3600 : 600,
  });
  if (error) throw error;
  return data === true;
}

function passwordIsValid(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && encoder.encode(value).length <= 72;
}

async function makeSession(email: string, password: string) {
  const { data, error } = await publicAuth.auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    token_type: data.session.token_type,
  };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return jsonResponse({ ok: true }, 200, origin);
  if (request.method !== "POST") return jsonResponse({ error: "지원하지 않는 요청입니다." }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return jsonResponse({ error: "허용되지 않은 웹사이트입니다." }, 403);

  try {
    const input = await request.json();
    const action = input?.action;
    const nickname = normalizeNickname(input?.nickname);
    const password = input?.password;
    if (nickname.length < 1 || nickname.length > 20 || /[\u0000-\u001f\u007f]/u.test(nickname)) {
      return jsonResponse({ error: "닉네임은 1~20자로 입력해 주세요." }, 400, origin);
    }
    if (!passwordIsValid(password)) {
      return jsonResponse({ error: "비밀번호는 8~72바이트로 입력해 주세요." }, 400, origin);
    }

    if (action === "register") {
      const code = typeof input?.adminClaimCode === "string" ? input.adminClaimCode.trim() : "";
      const isReserved = nickname.includes("인증됨");
      if (isReserved) {
        return jsonResponse({ error: "‘인증됨’은 닉네임에 넣을 수 없고 관리자에게만 별도 배지로 표시됩니다." }, 400, origin);
      }
      if (ADMIN_INITIAL_NAMES.has(nickname) && code.length < 20) {
        return jsonResponse({ error: "이 관리자 계정은 1회용 관리자 초대코드가 필요합니다." }, 400, origin);
      }
      if (!await allowRequest(request, "register")) {
        return jsonResponse({ error: "가입 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, 429, origin);
      }

      // A reserved, non-routable email lets Supabase Auth hash and verify passwords
      // without asking the player for an email address or exposing a service key.
      const email = `u_${crypto.randomUUID().replaceAll("-", "")}@accounts.roomchat.invalid`;
      const userMetadata: Record<string, unknown> = {
        nickname,
      };
      if (ADMIN_INITIAL_NAMES.has(nickname)) userMetadata.admin_claim_code = code;

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { roomchat_managed: true },
        user_metadata: userMetadata,
      });
      if (createError || !created.user) {
        // Do not reveal whether a username or one-time administrator invitation exists.
        return jsonResponse({ error: "계정을 만들지 못했습니다. 닉네임이나 초대코드를 확인해 주세요." }, 400, origin);
      }

      const { data: profileData, error: profileError } = await admin.rpc("roomchat_materialize_auth_profile", {
        p_user_id: created.user.id,
      });
      const profile = Array.isArray(profileData) ? profileData[0] : profileData;
      if (profileError || !profile) {
        return jsonResponse({ error: "계정은 만들어졌지만 프로필 설정을 마치지 못했습니다. 잠시 후 로그인해 주세요." }, 500, origin);
      }

      const session = await makeSession(email, password);
      if (!session) return jsonResponse({ error: "계정은 만들어졌지만 로그인에 실패했습니다. 다시 로그인해 주세요." }, 500, origin);
      return jsonResponse({ session, nickname: profile.nickname, isVerified: profile.is_verified }, 200, origin);
    }

    if (action === "login") {
      if (!await allowRequest(request, "login")) {
        return jsonResponse({ error: "로그인 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, 429, origin);
      }
      const nicknameKey = nickname.toLocaleLowerCase("ko-KR");
      const { data: profile, error: profileError } = await admin.from("roomchat_profiles")
        .select("id,nickname,is_verified")
        .eq("nickname_key", nicknameKey)
        .maybeSingle();
      if (profileError || !profile) return jsonResponse({ error: "닉네임 또는 비밀번호가 올바르지 않습니다." }, 401, origin);
      const { data: userResult, error: userError } = await admin.auth.admin.getUserById(profile.id);
      const email = userResult?.user?.email;
      if (userError || !email) return jsonResponse({ error: "닉네임 또는 비밀번호가 올바르지 않습니다." }, 401, origin);
      const session = await makeSession(email, password);
      if (!session) return jsonResponse({ error: "닉네임 또는 비밀번호가 올바르지 않습니다." }, 401, origin);
      return jsonResponse({ session, nickname: profile.nickname, isVerified: profile.is_verified }, 200, origin);
    }

    return jsonResponse({ error: "요청 유형을 확인해 주세요." }, 400, origin);
  } catch (_error) {
    // Never write passwords, invitation codes, or forwarded IP addresses to function logs.
    return jsonResponse({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 500, origin);
  }
});
