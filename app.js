import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  realtime: { params: { eventsPerSecond: 8 } },
});
const $ = (selector) => document.querySelector(selector);
const ui = {
  roomList: $('#room-list'), mobileRoomList: $('#mobile-room-list'),
  roomName: $('#current-room-name'), bannerName: $('#banner-room-name'), roomTopic: $('#room-topic'),
  presence: $('#presence-count'), presenceButton: $('#presence-button'), messages: $('#message-list'),
  connection: $('#connection-state'), nicknameLabel: $('#nickname-label'), nicknameButton: $('#nickname-button'),
  nicknameDialog: $('#nickname-dialog'), nicknameForm: $('#nickname-form'), nicknameInput: $('#nickname-input'),
  nicknameTitle: $('#nickname-title'), nicknameDescription: $('#nickname-description'),
  nicknameEyebrow: $('#nickname-eyebrow'), nicknameSubmit: $('#nickname-submit-button'),
  accountOpen: $('#account-open-button'), signOut: $('#sign-out-button'),
  accountDialog: $('#account-dialog'), accountForm: $('#account-form'), accountNickname: $('#account-nickname'),
  accountPassword: $('#account-password'), adminCodeWrap: $('#admin-code-wrap'), adminCode: $('#admin-claim-code'),
  accountTitle: $('#account-title'), accountDescription: $('#account-description'), accountSubmit: $('#account-submit-button'),
  accountCancel: $('#account-cancel-button'), roomDialog: $('#room-dialog'), roomForm: $('#room-form'), roomInput: $('#room-input'),
  roomDelete: $('#room-delete-button'), membersDialog: $('#members-dialog'), memberList: $('#member-list'),
  membersNote: $('#members-note'), membersClose: $('#members-close-button'), notificationButton: $('#notification-button'),
  notificationLabel: $('#notification-label'), messageForm: $('#message-form'), messageInput: $('#message-input'),
  send: $('#send-button'), imageFile: $('#image-file'), preview: $('#attachment-preview'),
  thumbnail: $('#attachment-thumbnail'), attachmentName: $('#attachment-name'), removeAttachment: $('#remove-attachment'),
  toast: $('#toast'), charCount: $('#char-count'),
};
const GUEST_ID_KEY = 'roomchat:guest-id';
const GUEST_TOKEN_KEY = 'roomchat:guest-token';
const ROOM_OWNER_PREFIX = 'roomchat:owner:';
const FIXED_ROOM_NAME = '슬랩배틀 라이벌 입양 피기';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ADMIN_NAMES = new Set(['[인증됨] 천사', '[인증됨] 크리스탈']);

function sessionValue(key, makeValue) {
  try {
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = makeValue();
      sessionStorage.setItem(key, value);
    }
    return value;
  } catch {
    return makeValue();
  }
}
const guestSessionId = sessionValue(GUEST_ID_KEY, () => crypto.randomUUID());
const guestToken = sessionValue(GUEST_TOKEN_KEY, () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', ''));
const state = {
  nickname: '', isVerified: false, isAdmin: false, user: null,
  rooms: [], room: null, roomChannel: null, roomsChannel: null, members: [], messages: [],
  attachment: null, attachmentUrl: '', notifications: false, toastTimer: 0,
  roomRequest: 0, kickTimer: 0, memberTimer: 0, identityTimer: 0, kickedRooms: new Set(),
  accountMode: 'register',
};

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('visible');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => ui.toast.classList.remove('visible'), 3600);
}
function errorText(error, fallback = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.') {
  const text = String(error?.message || '');
  const safeMessages = [
    '크리스탈 시청자', '인증됨', '닉네임', '방 이름', '운영자', '게스트', '이미지',
    '참여를 제한', '로그인이 필요', '관리자만', '방장은', '기본 방은', '비밀번호', '초대코드',
  ];
  return safeMessages.some((piece) => text.includes(piece)) ? text : fallback;
}
function setConnection(connected, label = connected ? '실시간 연결됨' : '연결 중') {
  ui.connection.classList.toggle('online', connected);
  ui.connection.querySelector('i').nextSibling.textContent = ` ${label}`;
}
function makeAvatar(name) {
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.style.setProperty('--avatar-hue', String(hue));
  avatar.textContent = [...name][0] || '•';
  return avatar;
}
function addVerifiedMark(parent) {
  const mark = document.createElement('span');
  mark.className = 'verified-box';
  mark.textContent = '✓';
  mark.setAttribute('aria-label', '인증된 관리자');
  parent.append(mark);
}
function formatTime(value) {
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function showLoading() {
  ui.messages.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'loading-state';
  loading.innerHTML = '<span class="spinner"></span><span>대화를 불러오는 중</span>';
  ui.messages.append(loading);
}
function roomOwnerToken(roomId) {
  try { return sessionStorage.getItem(`${ROOM_OWNER_PREFIX}${roomId}`); } catch { return null; }
}
function canManageRoom(room) {
  return Boolean(state.isAdmin || (state.user && room?.created_by === state.user.id) || roomOwnerToken(room?.id));
}
function sortedRooms() {
  return [...state.rooms].sort((a, b) => Number(Boolean(b.is_featured)) - Number(Boolean(a.is_featured)) || new Date(a.created_at) - new Date(b.created_at));
}
function renderRoomLists() {
  ui.roomList.replaceChildren();
  ui.mobileRoomList.replaceChildren();
  sortedRooms().forEach((room, index) => {
    const row = document.createElement('div');
    row.className = 'room-row';
    const desktop = document.createElement('button');
    desktop.type = 'button';
    desktop.className = `room-item${state.room?.id === room.id ? ' active' : ''}${room.is_featured ? ' featured' : ''}`;
    desktop.setAttribute('aria-current', state.room?.id === room.id ? 'page' : 'false');
    const number = document.createElement('span');
    number.className = 'room-number';
    number.textContent = room.is_featured ? '★' : String(index + 1).padStart(2, '0');
    const title = document.createElement('span');
    title.className = 'room-title';
    title.textContent = room.name;
    const arrow = document.createElement('span');
    arrow.className = 'room-arrow';
    arrow.textContent = '↗';
    desktop.append(number, title, arrow);
    desktop.addEventListener('click', () => switchRoom(room));
    row.append(desktop);
    ui.roomList.append(row);

    const mobile = document.createElement('button');
    mobile.type = 'button';
    mobile.className = `mobile-room-chip${state.room?.id === room.id ? ' active' : ''}${room.is_featured ? ' featured' : ''}`;
    mobile.textContent = `${room.is_featured ? '★ ' : ''}${room.name}`;
    mobile.addEventListener('click', () => switchRoom(room));
    ui.mobileRoomList.append(mobile);
  });
}
function updateRoomHeading(room) {
  ui.roomName.textContent = room.name;
  ui.bannerName.textContent = room.name;
  ui.roomTopic.textContent = room.is_featured
    ? '★ 고정 방 · 누구나 참여할 수 있어요'
    : `방 ${String(sortedRooms().findIndex((item) => item.id === room.id) + 1).padStart(2, '0')} · 누구나 참여할 수 있어요`;
  ui.roomDelete.hidden = !(state.isAdmin && !room.is_featured);
  renderRoomLists();
}
function removeMessage(messageId) {
  const id = String(messageId ?? '');
  if (!id) return;
  state.messages = state.messages.filter((message) => String(message.id) !== id);
  const node = ui.messages.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
  node?.remove();
  if (!state.messages.length) renderMessages();
}
function renderMessage(message) {
  const key = String(message.id);
  if (ui.messages.querySelector(`[data-message-id="${CSS.escape(key)}"]`)) return;
  ui.messages.querySelector('.empty-state, .loading-state')?.remove();
  const isOwn = (state.user && message.user_id === state.user.id) || (!state.user && message.guest_session_id === guestSessionId);
  const row = document.createElement('article');
  row.className = `message-row${isOwn ? ' own-message' : ''}${message.is_verified ? ' verified-message' : ''}`;
  row.dataset.messageId = key;
  row.append(makeAvatar(message.nickname || '익명'));
  const body = document.createElement('div');
  body.className = 'message-body';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const name = document.createElement('strong');
  name.className = message.is_verified ? 'admin-name' : '';
  name.textContent = message.nickname || '익명';
  meta.append(name);
  if (message.is_verified) addVerifiedMark(meta);
  const time = document.createElement('time');
  time.dateTime = message.created_at;
  time.textContent = formatTime(message.created_at);
  meta.append(time);
  body.append(meta);
  if (message.content) {
    const text = document.createElement('p');
    text.className = 'message-content';
    text.textContent = message.content;
    body.append(text);
  }
  if (message.image_path) {
    const { data } = supabase.storage.from('chat-images').getPublicUrl(message.image_path);
    const imageLink = document.createElement('a');
    imageLink.className = 'message-image-link';
    imageLink.href = data.publicUrl;
    imageLink.target = '_blank';
    imageLink.rel = 'noopener noreferrer';
    imageLink.setAttribute('aria-label', '공유 이미지 원본 보기');
    const image = document.createElement('img');
    image.className = 'message-image';
    image.src = data.publicUrl;
    image.alt = '채팅방에서 공유한 이미지';
    image.loading = 'lazy';
    imageLink.append(image);
    body.append(imageLink);
  }
  row.append(body);
  if (state.isAdmin) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'admin-action message-delete';
    remove.textContent = '삭제';
    remove.setAttribute('aria-label', '이 메시지 삭제');
    remove.addEventListener('click', () => deleteMessage(message));
    row.append(remove);
  }
  ui.messages.append(row);
}
function renderMessages() {
  ui.messages.replaceChildren();
  if (!state.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<span class="empty-symbol">✳</span><strong>아직 첫 메시지가 없어요.</strong><span>먼저 가볍게 인사해보세요.</span>';
    ui.messages.append(empty);
    return;
  }
  state.messages.forEach(renderMessage);
  ui.messages.scrollTop = ui.messages.scrollHeight;
}
function addMessage(message) {
  if (state.messages.some((item) => String(item.id) === String(message.id))) return;
  state.messages.push(message);
  state.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  renderMessage(message);
  ui.messages.scrollTop = ui.messages.scrollHeight;
}
function normalizeRpcRow(data) { return Array.isArray(data) ? data[0] : data; }
async function loadRooms() {
  const { data, error } = await supabase.from('rooms')
    .select('id,name,created_at,created_by,is_featured').order('created_at', { ascending: true }).limit(100);
  if (error) throw error;
  state.rooms = data || [];
  renderRoomLists();
  if (!state.room && state.rooms.length) {
    const room = sortedRooms().find((item) => item.is_featured) || sortedRooms()[0];
    await switchRoom(room);
  }
}
function renderMembers() {
  const members = state.members;
  ui.presence.textContent = String(members.length);
  ui.memberList.replaceChildren();
  ui.membersNote.textContent = canManageRoom(state.room)
    ? '이 방의 관리자예요. 원하지 않는 참여자는 방에서 내보낼 수 있어요.'
    : '각 방을 만든 사람은 자기 방의 운영자로 참여자를 내보낼 수 있어요.';
  if (!members.length) {
    const empty = document.createElement('div');
    empty.className = 'member-empty';
    empty.textContent = '아직 함께 있는 사람이 없어요.';
    ui.memberList.append(empty);
    return;
  }
  members.sort((a, b) => String(a.nickname || '').localeCompare(String(b.nickname || ''), 'ko'));
  for (const member of members) {
    const rawNickname = typeof member.nickname === 'string' ? member.nickname : '익명';
    const nickname = rawNickname.includes('인증됨') ? '크리스탈 시청자' : rawNickname;
    const verifiedAdmin = Boolean(member.isVerified && ADMIN_NAMES.has(rawNickname));
    const row = document.createElement('div');
    row.className = 'member-row';
    row.append(makeAvatar(nickname));
    const label = document.createElement('span');
    label.className = `member-name${verifiedAdmin ? ' admin-name' : ''}`;
    label.textContent = nickname;
    row.append(label);
    if (verifiedAdmin) addVerifiedMark(row);
    if (canManageRoom(state.room)) {
      if (state.isAdmin && !verifiedAdmin && (member.userId || member.guestSessionId)) {
        const clean = document.createElement('button');
        clean.className = 'admin-action';
        clean.type = 'button';
        clean.textContent = '이름 정리';
        clean.addEventListener('click', () => moderateNickname(member));
        row.append(clean);
      }
      const kick = document.createElement('button');
      kick.className = 'admin-action danger-action';
      kick.type = 'button';
      kick.textContent = '내보내기';
      kick.addEventListener('click', () => kickMember(member));
      row.append(kick);
    }
    ui.memberList.append(row);
  }
}
async function refreshMembers(roomId = state.room?.id) {
  if (!roomId) return;
  const { data, error } = await supabase.rpc('roomchat_list_members', { p_room_id: roomId });
  if (error || state.room?.id !== roomId) return;
  state.members = (data || []).map((member) => ({
    userId: member.user_id,
    guestSessionId: member.guest_session_id,
    nickname: member.nickname,
    isVerified: Boolean(member.is_verified),
  }));
  renderMembers();
}
function presencePayload() {
  // Presence is only a change signal. Identity and verified flags come from a server RPC.
  return { online: true };
}
async function trackActiveMember(roomId, request) {
  if (!state.nickname || !state.room || state.room.id !== roomId || request !== state.roomRequest) return false;
  const { error } = await supabase.rpc('roomchat_track_member', {
    p_room_id: roomId,
    p_guest_session_id: state.user ? null : guestSessionId,
    p_guest_token: state.user ? null : guestToken,
  });
  if (error) {
    if (String(error.message || '').includes('참여를 제한')) await checkForKick(roomId, request);
    return false;
  }
  await refreshMembers(roomId);
  return request === state.roomRequest;
}
async function subscribeCurrentRoom(request) {
  const room = state.room;
  if (!room || !state.nickname || request !== state.roomRequest) return;
  const { data: kicked, error: kickError } = await supabase.rpc('roomchat_is_kicked', {
    p_room_id: room.id,
    p_guest_session_id: state.user ? null : guestSessionId,
    p_guest_token: state.user ? null : guestToken,
  });
  if (request !== state.roomRequest) return;
  if (!kickError && kicked) {
    state.kickedRooms.add(room.id);
    const lobby = sortedRooms().find((item) => item.is_featured && item.id !== room.id) || sortedRooms().find((item) => item.id !== room.id);
    showToast('이 방의 운영자가 참여를 제한했어요. 다른 방으로 이동합니다.');
    if (lobby) { state.room = null; await switchRoom(lobby); }
    return;
  }
  const channel = supabase.channel(`room:${room.id}`, { config: { presence: { key: state.user?.id || `guest:${guestSessionId}` }, broadcast: { self: false } } });
  channel
    .on('presence', { event: 'sync' }, () => refreshMembers(room.id))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `room_id=eq.${room.id}` }, (payload) => {
      if (payload.eventType === 'DELETE') removeMessage(payload.old?.id);
      else if (payload.new) {
        addMessage(payload.new);
        if (payload.new.nickname !== state.nickname && state.notifications) notifyIncoming(payload.new);
      }
    })
    .subscribe(async (status) => {
      if (request !== state.roomRequest) return;
      if (status === 'SUBSCRIBED') {
        setConnection(true);
        const active = await trackActiveMember(room.id, request);
        if (!active || request !== state.roomRequest) return;
        const { error } = await channel.track(presencePayload());
        if (error) console.warn('presence tracking failed');
        window.clearInterval(state.memberTimer);
        state.memberTimer = window.setInterval(() => trackActiveMember(room.id, request), 30000);
        await refreshMembers(room.id);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setConnection(false, '재연결 중');
      }
    });
  state.roomChannel = channel;
  window.clearInterval(state.kickTimer);
  window.clearInterval(state.memberTimer);
  state.kickTimer = window.setInterval(() => checkForKick(room.id, request), 4500);
}
async function checkForKick(roomId, request) {
  if (!state.nickname || !state.room || state.room.id !== roomId || request !== state.roomRequest) return;
  const { data, error } = await supabase.rpc('roomchat_is_kicked', {
    p_room_id: roomId,
    p_guest_session_id: state.user ? null : guestSessionId,
    p_guest_token: state.user ? null : guestToken,
  });
  if (error || !data) return;
  state.kickedRooms.add(roomId);
  if (state.roomChannel) await supabase.removeChannel(state.roomChannel);
  state.roomChannel = null;
  showToast('방 운영자가 참여를 제한했어요. 이 방에서는 더 이상 대화할 수 없습니다.');
  const other = sortedRooms().find((room) => room.id !== roomId && room.is_featured) || sortedRooms().find((room) => room.id !== roomId);
  if (other) { state.room = null; await switchRoom(other); }
}
async function switchRoom(room) {
  if (!room || (state.room?.id === room.id && state.roomChannel)) return;
  state.room = room;
  const request = ++state.roomRequest;
  if (state.roomChannel) {
    const previous = state.roomChannel;
    state.roomChannel = null;
    await supabase.removeChannel(previous);
  }
  window.clearInterval(state.kickTimer);
  window.clearInterval(state.memberTimer);
  state.members = [];
  updateRoomHeading(room);
  state.messages = [];
  showLoading();
  renderMembers();
  const { data, error } = await supabase.from('messages')
    .select('id,room_id,nickname,content,image_path,created_at,user_id,guest_session_id,is_verified')
    .eq('room_id', room.id).order('created_at', { ascending: true }).limit(100);
  if (request !== state.roomRequest) return;
  if (error) {
    ui.messages.replaceChildren();
    showToast('대화 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    console.error('message history request failed');
    return;
  }
  state.messages = data || [];
  renderMessages();
  if (state.nickname) await subscribeCurrentRoom(request);
}
async function createRoom(name) {
  const cleanName = name.trim().replace(/\s+/gu, ' ');
  if (cleanName.length < 2 || cleanName.length > 32) return showToast('방 이름은 2~32자로 입력해 주세요.');
  const ownerToken = state.user ? null : `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const { data, error } = await supabase.rpc('roomchat_create_room', {
    p_name: cleanName,
    p_guest_session_id: state.user ? null : guestSessionId,
    p_guest_token: state.user ? null : guestToken,
    p_owner_token: ownerToken,
  });
  if (error) { showToast(errorText(error, '방을 만들지 못했어요.')); return; }
  const room = normalizeRpcRow(data);
  if (!room?.id) { showToast('방이 만들어지지 않았어요. 다시 시도해 주세요.'); return; }
  if (!state.rooms.some((item) => item.id === room.id)) state.rooms.push(room);
  if (ownerToken) {
    try { sessionStorage.setItem(`${ROOM_OWNER_PREFIX}${room.id}`, ownerToken); } catch { /* Browser session may be ephemeral. */ }
  }
  renderRoomLists();
  state.room = null;
  await switchRoom(room);
  showToast(`“${room.name}” 방을 만들었어요. 이 탭에서 방 운영 권한을 유지해요.`);
}
async function setNickname(name) {
  const cleanName = name.trim().replace(/\s+/gu, ' ');
  if (!cleanName) return;
  let result;
  if (state.user) {
    const { data, error } = await supabase.rpc('roomchat_update_my_nickname', { p_requested: cleanName });
    if (error) return showToast(errorText(error));
    result = data;
  } else {
    const { data, error } = await supabase.rpc('roomchat_claim_guest_nickname', {
      p_guest_session_id: guestSessionId, p_guest_token: guestToken, p_requested: cleanName,
    });
    if (error) return showToast(errorText(error, '게스트 닉네임을 저장하지 못했어요.'));
    result = data;
  }
  const changed = result !== cleanName;
  state.nickname = result;
  ui.nicknameLabel.textContent = result;
  ui.nicknameButton.querySelector('.avatar-dot').textContent = [...result][0] || '•';
  ui.nicknameButton.querySelector('.verified-box').hidden = !state.isVerified;
  ui.nicknameLabel.classList.toggle('admin-name', state.isVerified);
  ui.nicknameDialog.close();
  if (state.room) {
    const currentRoom = state.room;
    state.room = null;
    await switchRoom(currentRoom);
  }
  if (changed) showToast(`사용할 수 없거나 이미 사용 중인 이름이라 “${result}”로 바꿨어요.`);
  else showToast(state.user ? '계정 닉네임을 저장했어요.' : '게스트 닉네임을 정했어요. 브라우저를 닫으면 유지되지 않아요.');
}
function updateIdentityUI() {
  ui.nicknameLabel.textContent = state.nickname || '닉네임';
  ui.nicknameLabel.classList.toggle('admin-name', state.isVerified);
  ui.nicknameButton.querySelector('.avatar-dot').textContent = [...(state.nickname || '?')][0] || '?';
  ui.nicknameButton.querySelector('.verified-box').hidden = !state.isVerified;
  ui.accountOpen.hidden = Boolean(state.user);
  ui.signOut.hidden = !state.user;
  renderRoomLists();
  if (state.room) updateRoomHeading(state.room);
  if (state.roomChannel) {
    state.roomChannel.track(presencePayload()).then(() => trackActiveMember(state.room.id, state.roomRequest)).catch(() => {});
  }
  renderMessages();
}
async function applySession(session, nicknameHint = '') {
  state.user = session?.user || null;
  if (!state.user) {
    state.nickname = '';
    state.isVerified = false;
    state.isAdmin = false;
    updateIdentityUI();
    return;
  }
  const { data: profile, error } = await supabase.from('roomchat_profiles')
    .select('id,nickname,is_verified').eq('id', state.user.id).maybeSingle();
  if (error || !profile) {
    await supabase.auth.signOut();
    state.user = null;
    throw new Error('계정 프로필을 찾을 수 없습니다.');
  }
  state.nickname = nicknameHint || profile.nickname;
  state.isVerified = Boolean(profile.is_verified);
  const { data: admin } = await supabase.rpc('roomchat_is_admin');
  state.isAdmin = admin === true;
  updateIdentityUI();
}
async function callAuth(action, nickname, password, adminClaimCode = '') {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/u, '')}/functions/v1/roomchat-auth`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action, nickname, password, adminClaimCode }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '계정 요청을 처리하지 못했어요.');
  const { data, error } = await supabase.auth.setSession({
    access_token: result.session.access_token,
    refresh_token: result.session.refresh_token,
  });
  if (error || !data.session) throw error || new Error('로그인 세션을 만들지 못했습니다.');
  await applySession(data.session, result.nickname);
  return result;
}
function setAccountMode(mode) {
  state.accountMode = mode;
  for (const button of document.querySelectorAll('[data-account-mode]')) {
    button.classList.toggle('active', button.dataset.accountMode === mode);
  }
  ui.accountTitle.textContent = mode === 'register' ? '계정 만들기' : '계정 로그인';
  ui.accountDescription.textContent = mode === 'register'
    ? '닉네임과 비밀번호만으로 계정을 만들어요. 실제 이메일은 받거나 저장하지 않습니다.'
    : '저장된 계정 닉네임과 비밀번호로 로그인해요.';
  ui.accountSubmit.innerHTML = `${mode === 'register' ? '계정 만들기' : '로그인'} <span aria-hidden="true">↗</span>`;
  ui.accountPassword.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  updateAdminCodeVisibility();
}
function updateAdminCodeVisibility() {
  const name = ui.accountNickname.value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const required = state.accountMode === 'register' && ADMIN_NAMES.has(name);
  ui.adminCodeWrap.hidden = !required;
  ui.adminCode.required = required;
  if (!required) ui.adminCode.value = '';
}
function showNicknameDialog() {
  ui.nicknameEyebrow.textContent = state.user ? 'ACCOUNT NICKNAME' : 'GUEST MODE';
  ui.nicknameTitle.innerHTML = state.user ? '닉네임을<br />바꿀까요?' : '어떤 이름으로<br />인사할까요?';
  ui.nicknameDescription.textContent = state.user
    ? '계정 닉네임은 저장되어 다음에도 사용할 수 있어요. 관리자의 인증 닉네임은 보호됩니다.'
    : '게스트 닉네임은 이 탭에서만 사용돼요. 계정을 만들면 닉네임이 저장되고 언제든 바꿀 수 있어요.';
  ui.nicknameSubmit.innerHTML = `${state.user ? '닉네임 저장' : '게스트로 입장'} <span aria-hidden="true">↗</span>`;
  ui.nicknameInput.value = state.nickname;
  ui.accountOpen.hidden = Boolean(state.user);
  ui.signOut.hidden = !state.user;
  ui.nicknameDialog.showModal();
  window.setTimeout(() => ui.nicknameInput.focus(), 80);
}
function showAccountDialog() {
  setAccountMode('register');
  ui.accountNickname.value = state.nickname && !state.user ? state.nickname : '';
  ui.accountPassword.value = '';
  ui.adminCode.value = '';
  ui.accountDialog.showModal();
  window.setTimeout(() => ui.accountNickname.focus(), 80);
}
async function openRoomDialog() {
  if (!state.nickname) { showNicknameDialog(); return; }
  ui.roomInput.value = '';
  ui.roomDialog.showModal();
  ui.roomInput.focus();
}
async function sendMessage(event) {
  event?.preventDefault();
  if (!state.nickname) { showNicknameDialog(); return; }
  if (!state.room) return showToast('먼저 채팅방을 선택해 주세요.');
  const content = ui.messageInput.value.trim();
  const image = state.attachment;
  if (!content && !image) return;
  ui.send.disabled = true;
  ui.send.classList.add('sending');
  let imagePath = null;
  try {
    if (image) {
      const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
      if (!supportedTypes.includes(image.type) || image.size > MAX_IMAGE_BYTES) throw new Error('이미지 파일 형식 또는 크기를 확인해 주세요.');
      const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' })[image.type] || 'img';
      imagePath = `${state.room.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('chat-images').upload(imagePath, image, {
        contentType: image.type, cacheControl: '3600', upsert: false,
      });
      if (uploadError) throw uploadError;
    }
    const { data, error } = await supabase.rpc('roomchat_post_message', {
      p_room_id: state.room.id,
      p_content: content || null,
      p_image_path: imagePath,
      p_guest_session_id: state.user ? null : guestSessionId,
      p_guest_token: state.user ? null : guestToken,
    });
    if (error) throw error;
    const inserted = normalizeRpcRow(data);
    if (inserted) addMessage(inserted);
    ui.messageInput.value = '';
    ui.messageInput.style.height = 'auto';
    ui.charCount.textContent = '0 / 2000';
    clearAttachment();
  } catch (error) {
    if (imagePath) await supabase.storage.from('chat-images').remove([imagePath]).catch(() => {});
    showToast(errorText(error, '전송하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.'));
  } finally {
    ui.send.disabled = false;
    ui.send.classList.remove('sending');
    ui.messageInput.focus();
  }
}
async function enableNotifications() {
  if (!('Notification' in window)) return showToast('이 브라우저는 알림 기능을 지원하지 않아요.');
  if (Notification.permission === 'denied') return showToast('브라우저 설정에서 이 사이트의 알림을 허용해 주세요.');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return showToast('알림 권한이 허용되지 않았어요.');
  state.notifications = !state.notifications;
  ui.notificationButton.setAttribute('aria-pressed', String(state.notifications));
  ui.notificationButton.classList.toggle('enabled', state.notifications);
  ui.notificationLabel.textContent = state.notifications ? '알림 켜짐' : '알림 켜기';
  showToast(state.notifications ? '새 메시지 알림을 받을게요.' : '새 메시지 알림을 껐어요.');
}
async function notifyIncoming(message) {
  const title = `${message.nickname} · ${state.room?.name || 'roomchat'}`;
  const body = message.content || '사진을 공유했어요.';
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.showNotification) {
      await registration.showNotification(title, { body, icon: './icon.svg', badge: './icon.svg', tag: `roomchat-${message.id}`, data: { url: './' } });
    } else new Notification(title, { body, icon: './icon.svg', tag: `roomchat-${message.id}` });
  } catch { /* Notifications are an optional browser capability. */ }
}
function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
function chooseAttachment(file) {
  if (!file) return;
  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
  if (!supportedTypes.includes(file.type)) return showToast('JPEG, PNG, WebP, GIF, AVIF 이미지만 첨부할 수 있어요.');
  if (file.size > MAX_IMAGE_BYTES) return showToast('이미지는 8MB 이하로 선택해 주세요.');
  if (state.attachmentUrl) URL.revokeObjectURL(state.attachmentUrl);
  state.attachment = file;
  state.attachmentUrl = URL.createObjectURL(file);
  ui.thumbnail.src = state.attachmentUrl;
  ui.attachmentName.textContent = file.name || '붙여넣은 이미지';
  ui.preview.hidden = false;
  ui.messageInput.focus();
}
function clearAttachment() {
  if (state.attachmentUrl) URL.revokeObjectURL(state.attachmentUrl);
  state.attachment = null;
  state.attachmentUrl = '';
  ui.thumbnail.removeAttribute('src');
  ui.preview.hidden = true;
  ui.imageFile.value = '';
}
async function removeImages(paths) {
  const usable = [...new Set((paths || []).filter((path) => typeof path === 'string' && path.length))];
  for (let offset = 0; offset < usable.length; offset += 100) {
    const { error } = await supabase.storage.from('chat-images').remove(usable.slice(offset, offset + 100));
    if (error) throw error;
  }
}
async function deleteMessage(message) {
  if (!state.isAdmin || !window.confirm('이 메시지를 삭제할까요?')) return;
  try {
    if (message.image_path) await removeImages([message.image_path]);
    const { error } = await supabase.rpc('roomchat_admin_delete_message', { p_message_id: message.id });
    if (error) throw error;
    removeMessage(message.id);
    showToast('메시지를 삭제했어요.');
  } catch (error) { showToast(errorText(error, '메시지를 삭제하지 못했어요.')); }
}
async function deleteRoom() {
  const room = state.room;
  if (!state.isAdmin || !room || room.is_featured) return;
  if (!window.confirm(`“${room.name}” 방과 그 방의 메시지 기록을 삭제할까요?`)) return;
  try {
    const { data: paths, error: pathError } = await supabase.rpc('roomchat_admin_room_image_paths', { p_room_id: room.id });
    if (pathError) throw pathError;
    await removeImages(paths || []);
    const { error } = await supabase.rpc('roomchat_admin_delete_room', { p_room_id: room.id });
    if (error) throw error;
    state.rooms = state.rooms.filter((item) => item.id !== room.id);
    const fallback = sortedRooms().find((item) => item.is_featured) || sortedRooms()[0];
    state.room = null;
    renderRoomLists();
    if (fallback) await switchRoom(fallback);
    showToast('방과 메시지를 삭제했어요.');
  } catch (error) { showToast(errorText(error, '방을 삭제하지 못했어요.')); }
}
async function kickMember(member) {
  if (!canManageRoom(state.room)) return showToast('이 방의 운영자만 참여자를 내보낼 수 있어요.');
  if (!window.confirm(`${member.nickname || '이 참여자'}를 이 방에서 내보낼까요?`)) return;
  const { error } = await supabase.rpc('roomchat_kick_member', {
    p_room_id: state.room.id,
    p_user_id: member.userId || null,
    p_guest_session_id: member.userId ? null : member.guestSessionId,
    p_owner_token: roomOwnerToken(state.room.id),
  });
  if (error) return showToast(errorText(error, '참여자를 내보내지 못했어요.'));
  showToast(`${member.nickname || '참여자'}가 이 방에서 내보내졌어요.`);
}
async function moderateNickname(member) {
  if (!state.isAdmin) return;
  if (!window.confirm(`${member.nickname} 닉네임을 “크리스탈 시청자”로 정리할까요?`)) return;
  const call = member.userId
    ? supabase.rpc('roomchat_admin_rename_profile', { p_user_id: member.userId })
    : supabase.rpc('roomchat_admin_rename_guest', { p_guest_session_id: member.guestSessionId });
  const { data, error } = await call;
  if (error) return showToast(errorText(error, '닉네임을 정리하지 못했어요.'));
  showToast(`닉네임을 “${data}”로 바꿨어요.`);
  await refreshMembers();
}
function openMembers() {
  renderMembers();
  ui.membersDialog.showModal();
  refreshMembers();
}
async function refreshIdentity() {
  if (!state.nickname) return;
  let newName = state.nickname;
  if (state.user) {
    const { data } = await supabase.from('roomchat_profiles').select('nickname,is_verified')
      .eq('id', state.user.id).maybeSingle();
    if (data) {
      newName = data.nickname;
      state.isVerified = Boolean(data.is_verified);
    }
  } else {
    const { data, error } = await supabase.rpc('roomchat_refresh_guest', {
      p_guest_session_id: guestSessionId, p_guest_token: guestToken,
    });
    if (!error && data) newName = data;
  }
  if (newName !== state.nickname) {
    state.nickname = newName;
    updateIdentityUI();
    showToast(`관리자 조치로 닉네임이 “${newName}”으로 변경됐어요.`);
  } else if (state.roomChannel) {
    await state.roomChannel.track(presencePayload()).catch(() => {});
  }
}
function setupEvents() {
  ui.nicknameForm.addEventListener('submit', (event) => { event.preventDefault(); setNickname(ui.nicknameInput.value); });
  ui.nicknameButton.addEventListener('click', showNicknameDialog);
  ui.accountOpen.addEventListener('click', () => { ui.nicknameDialog.close(); showAccountDialog(); });
  ui.signOut.addEventListener('click', async () => {
    await supabase.auth.signOut();
    await applySession(null);
    ui.nicknameDialog.close();
    showToast('로그아웃했어요. 이번 탭에서 게스트로 계속 이용할 수 있어요.');
    showNicknameDialog();
  });
  $('#new-room-button').addEventListener('click', openRoomDialog);
  $('#mobile-new-room-button').addEventListener('click', openRoomDialog);
  $('#cancel-room').addEventListener('click', () => ui.roomDialog.close());
  ui.roomForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = ui.roomInput.value.trim();
    ui.roomDialog.close();
    createRoom(value);
  });
  ui.roomDelete.addEventListener('click', deleteRoom);
  ui.presenceButton.addEventListener('click', openMembers);
  ui.membersClose.addEventListener('click', () => ui.membersDialog.close());
  ui.notificationButton.addEventListener('click', enableNotifications);
  ui.messageForm.addEventListener('submit', sendMessage);
  ui.messageInput.addEventListener('input', () => {
    ui.messageInput.style.height = 'auto';
    ui.messageInput.style.height = `${Math.min(ui.messageInput.scrollHeight, 150)}px`;
    ui.charCount.textContent = `${ui.messageInput.value.length} / 2000`;
  });
  ui.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(event); }
  });
  ui.imageFile.addEventListener('change', (event) => chooseAttachment(event.target.files?.[0]));
  ui.removeAttachment.addEventListener('click', clearAttachment);
  ui.messageInput.addEventListener('paste', (event) => {
    const items = [...(event.clipboardData?.items || [])];
    const file = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    if (file) { event.preventDefault(); chooseAttachment(file); showToast('붙여넣은 이미지를 첨부했어요.'); }
  });
  ui.messages.addEventListener('dragover', (event) => event.preventDefault());
  ui.messages.addEventListener('drop', (event) => {
    event.preventDefault();
    const image = [...(event.dataTransfer?.files || [])].find((file) => file.type.startsWith('image/'));
    if (image) chooseAttachment(image);
  });
  document.querySelectorAll('[data-account-mode]').forEach((button) => button.addEventListener('click', () => setAccountMode(button.dataset.accountMode)));
  ui.accountNickname.addEventListener('input', updateAdminCodeVisibility);
  ui.accountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = ui.accountNickname.value.normalize('NFC').trim().replace(/\s+/gu, ' ');
    const password = ui.accountPassword.value;
    const code = ui.adminCode.value.trim();
    if (password.length < 8 || new TextEncoder().encode(password).length > 72) return showToast('비밀번호는 8~72바이트로 입력해 주세요.');
    ui.accountSubmit.disabled = true;
    try {
      const result = await callAuth(state.accountMode, name, password, code);
      ui.accountPassword.value = '';
      ui.adminCode.value = '';
      ui.accountDialog.close();
      ui.nicknameDialog.close();
      if (result.nickname !== name) showToast(`사용할 수 없거나 이미 사용 중인 이름이라 “${result.nickname}”로 저장했어요.`);
      else showToast(state.accountMode === 'register' ? '계정을 만들고 로그인했어요. 닉네임은 저장됩니다.' : '로그인했어요.');
      if (state.room) { const current = state.room; state.room = null; await switchRoom(current); }
    } catch (error) { showToast(errorText(error, '계정을 확인하지 못했어요.')); }
    finally { ui.accountSubmit.disabled = false; }
  });
  ui.accountCancel.addEventListener('click', () => { ui.accountDialog.close(); showNicknameDialog(); });
}

async function boot() {
  setupEvents();
  registerServiceWorker();
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) await applySession(data.session);
  } catch (error) { console.warn('Could not restore account session'); }
  if (!state.user) {
    const { data: guestName, error: guestError } = await supabase.rpc('roomchat_refresh_guest', {
      p_guest_session_id: guestSessionId, p_guest_token: guestToken,
    });
    if (!guestError && guestName) {
      state.nickname = guestName;
      updateIdentityUI();
    }
  }
  try {
    await loadRooms();
    state.roomsChannel = supabase.channel('public:rooms', { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rooms' }, ({ new: room }) => {
        if (!state.rooms.some((item) => item.id === room.id)) { state.rooms.push(room); renderRoomLists(); }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rooms' }, ({ old: room }) => {
        const deletedId = room?.id;
        if (!deletedId) return;
        state.rooms = state.rooms.filter((room) => room.id !== deletedId);
        if (state.room?.id === deletedId) {
          state.room = null;
          const fallback = sortedRooms().find((room) => room.is_featured) || sortedRooms()[0];
          if (fallback) switchRoom(fallback);
        }
        renderRoomLists();
      }).subscribe();
  } catch (error) {
    console.error('Room bootstrap failed');
    setConnection(false, '연결 확인 필요');
    showToast('채팅 서버에 연결하지 못했어요. Supabase 설정을 확인해 주세요.');
  }
  if (!state.user && !state.nickname) showNicknameDialog();
  state.identityTimer = window.setInterval(refreshIdentity, 45000);
}

boot();
