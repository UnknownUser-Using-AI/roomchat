import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, GIPHY_API_KEY } from './config.js?v=20261018-giphy';
import { initSocial, renderMentions, mentionsName } from './social.js?v=20261020-social';
import { ensureFont, fontStack } from './fonts.js?v=20261020-social';

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
  accountModeGroup: $('#account-mode-group'), adminCodeHelp: $('#admin-code-help'),
  adminPanelButton: $('#admin-panel-button'), adminPanelDialog: $('#admin-panel-dialog'),
  adminPanelClose: $('#admin-panel-close'), adminPanelSummary: $('#admin-panel-summary'),
  adminPanelContent: $('#admin-panel-content'),
  gifButton: $('#gif-button'), gifDialog: $('#gif-dialog'), gifClose: $('#gif-close'), gifForm: $('#gif-form'),
  gifQuery: $('#gif-query'), gifStatus: $('#gif-status'), gifGrid: $('#gif-grid'),
  avatarSection: $('#avatar-section'), avatarDrop: $('#avatar-drop'), avatarPreview: $('#avatar-preview'),
  avatarHelp: $('#avatar-help'), avatarFile: $('#avatar-file'), avatarRemove: $('#avatar-remove'),
  kickDialog: $('#kick-dialog'), kickTarget: $('#kick-target'), styleOpen: $('#style-open-button'),
  roomIcon: $('#room-icon'), roomImageButton: $('#room-image-button'), roomImageRemove: $('#room-image-remove'),
  roomImageFile: $('#room-image-file'), roomBanner: $('.topbar'),
};
const GUEST_ID_KEY = 'roomchat:guest-id';
const GUEST_TOKEN_KEY = 'roomchat:guest-token';
const ROOM_OWNER_PREFIX = 'roomchat:owner:';
const FIXED_ROOM_NAME = '슬랩배틀 라이벌 입양 피기';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ADMIN_INITIAL_NAMES = new Set(['천사', '크리스탈']);
const GUIDE_ROOM_NAME = '설명 방';
const GIF_PREFIX = '[gif]';
// 서버는 내용을 검사하지 않으므로, 화면에는 GIPHY 미디어 주소만 그림으로 그립니다.
const GIF_URL_PATTERN = /^\[gif\](https:\/\/media\d*\.giphy\.com\/media\/[A-Za-z0-9_\-/.]+\.gif)$/u;
const AVATAR_SIZE = 256;
const AVATAR_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

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
  accountMode: 'register', adminPanelTab: 'overview', pendingAdminInvite: null,
  avatars: new Map(), myAvatarPath: null, avatarBusy: false, gifRequest: 0,
  profiles: new Map(),
};
let social = null;

const ADMIN_INVITE_STORAGE_KEY = 'roomchat:admin-invite';
function restoreAdminInvite() {
  const readStored = () => {
    try {
      const value = JSON.parse(sessionStorage.getItem(ADMIN_INVITE_STORAGE_KEY) || 'null');
      return value && ['천사', '크리스탈'].includes(value.nickname) && /^[0-9a-f]{64}$/u.test(value.code)
        ? value : null;
    } catch { return null; }
  };
  const fragment = new URLSearchParams(location.hash.slice(1));
  const match = fragment.get('admin-invite')?.match(/^(angel|crystal)\.([0-9a-f]{64})$/u);
  if (match) {
    state.pendingAdminInvite = { nickname: match[1] === 'angel' ? '천사' : '크리스탈', code: match[2] };
    try { sessionStorage.setItem(ADMIN_INVITE_STORAGE_KEY, JSON.stringify(state.pendingAdminInvite)); } catch { /* Keep the invite in memory for this tab. */ }
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    return;
  }
  state.pendingAdminInvite = readStored();
}
function clearAdminInvite() {
  state.pendingAdminInvite = null;
  try { sessionStorage.removeItem(ADMIN_INVITE_STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('visible');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => ui.toast.classList.remove('visible'), 3600);
}
function errorText(error, fallback = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.') {
  const text = String(error?.message || '');
  // 서버가 직접 만든 안내 문구는 한국어라서 그대로 보여주고, 영어 시스템 오류는 숨깁니다.
  return /[가-힣]/u.test(text) ? text : fallback;
}
function setConnection(connected, label = connected ? '실시간 연결됨' : '연결 중') {
  ui.connection.classList.toggle('online', connected);
  ui.connection.querySelector('i').nextSibling.textContent = ` ${label}`;
}
function avatarPublicUrl(path) {
  return path ? supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl : '';
}
function paintAvatar(element, name, url) {
  element.replaceChildren();
  if (url) {
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => { element.replaceChildren(document.createTextNode([...name][0] || '•')); }, { once: true });
    element.append(image);
  } else {
    element.textContent = [...name][0] || '•';
  }
  element.classList.toggle('has-photo', Boolean(url));
}
function makeAvatar(name, userId = null) {
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.style.setProperty('--avatar-hue', String(hue));
  if (userId) {
    avatar.dataset.userId = userId;
    avatar.classList.add('clickable');
    avatar.addEventListener('click', (event) => { event.stopPropagation(); social?.openProfile(userId); });
  }
  avatar.dataset.name = name;
  paintAvatar(avatar, name, userId ? state.avatars.get(userId) || '' : '');
  return avatar;
}
function applyAvatars() {
  document.querySelectorAll('.message-avatar[data-user-id]').forEach((element) => {
    const url = state.avatars.get(element.dataset.userId) || '';
    const shown = element.querySelector('img')?.getAttribute('src') || '';
    if (url !== shown) paintAvatar(element, element.dataset.name || '', url);
  });
  const mine = state.user ? state.avatars.get(state.user.id) || '' : '';
  paintAvatar(ui.nicknameButton.querySelector('.avatar-dot'), state.nickname || '?', mine);
  paintAvatar(ui.avatarPreview, state.nickname || '?', mine);
  ui.avatarRemove.hidden = !mine;
}
// 프로필(사진·글꼴·색·태그)은 social.js가 한 번에 불러와 캐시합니다.
async function loadAvatars(userIds) {
  await social?.loadProfiles(userIds);
}
function isOwnMessage(message) {
  return Boolean((state.user && message.user_id === state.user.id) || (!state.user && message.guest_session_id === guestSessionId));
}
function getMentionNames() {
  const names = new Set(state.members.map((member) => member.nickname).filter(Boolean));
  state.messages.forEach((message) => { if (message.nickname) names.add(displayNickname(message.nickname, Boolean(message.is_verified))); });
  return [...names];
}
function addVerifiedMark(parent) {
  const mark = document.createElement('span');
  mark.className = 'verified-box';
  mark.textContent = '[인증됨]';
  mark.setAttribute('aria-label', '인증된 관리자');
  mark.title = '인증된 관리자';
  parent.append(mark);
}
function displayNickname(value, verified = false) {
  const name = typeof value === 'string' ? value : '익명';
  return verified ? name.replace(/^\[인증됨\]\s*/u, '') || '관리자' : name;
}
function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
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
function isGuideRoom(room) { return Boolean(room?.is_featured && room.name === GUIDE_ROOM_NAME); }
function updateComposerAvailability() {
  const guide = isGuideRoom(state.room);
  ui.messageInput.disabled = guide;
  ui.messageInput.placeholder = guide ? '설명 방에서는 채팅할 수 없어요.' : '이 방에 한마디 남겨보세요…';
  ui.send.disabled = guide || ui.send.classList.contains('sending');
  ui.imageFile.disabled = guide;
  ui.gifButton.disabled = guide;
  const imageButton = ui.messageForm.querySelector('label[for="image-file"]');
  if (imageButton) imageButton.hidden = guide;
  const footnote = ui.messageForm.parentElement.querySelector('.composer-foot span');
  if (footnote) footnote.textContent = guide ? '이 방은 안내 전용이에요.' : 'Enter로 전송 · Shift + Enter로 줄바꿈';
}
function sortedRooms() {
  return [...state.rooms].sort((a, b) => Number(isGuideRoom(b)) - Number(isGuideRoom(a))
    || Number(Boolean(b.is_featured)) - Number(Boolean(a.is_featured))
    || new Date(a.created_at) - new Date(b.created_at));
}
function renderRoomLists() {
  ui.roomList.replaceChildren();
  ui.mobileRoomList.replaceChildren();
  const railRooms = $('#rail-room-list');
  railRooms?.replaceChildren();
  sortedRooms().forEach((room, index) => {
    if (railRooms) {
      const railButton = document.createElement('button');
      railButton.type = 'button';
      railButton.className = `rail-room-button${state.room?.id === room.id ? ' active' : ''}`;
      railButton.title = room.name;
      railButton.setAttribute('aria-label', `${room.name} 방으로 이동`);
      if (room.image_path) {
        const railImage = document.createElement('img');
        railImage.src = roomImageUrl(room);
        railImage.alt = '';
        railImage.loading = 'lazy';
        railImage.onerror = () => { railButton.textContent = room.is_featured ? '★' : '#'; };
        railButton.append(railImage);
      } else {
        railButton.textContent = room.is_featured ? '★' : '#';
      }
      railButton.addEventListener('click', () => switchRoom(room));
      railRooms.append(railButton);
    }
    const row = document.createElement('div');
    row.className = 'room-row';
    const desktop = document.createElement('button');
    desktop.type = 'button';
    desktop.className = `room-item${state.room?.id === room.id ? ' active' : ''}${room.is_featured ? ' featured' : ''}`;
    desktop.setAttribute('aria-current', state.room?.id === room.id ? 'page' : 'false');
    const number = document.createElement('span');
    number.className = 'room-number';
    if (room.image_path) { number.classList.add('has-image'); paintAvatar(number, room.name, roomImageUrl(room)); }
    else number.textContent = room.is_featured ? '★' : '#';
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
    if (room.image_path) {
      const icon = document.createElement('span');
      icon.className = 'chip-icon';
      paintAvatar(icon, room.name, roomImageUrl(room));
      mobile.append(icon, document.createTextNode(`${room.is_featured ? '★ ' : ''}${room.name}`));
    } else mobile.textContent = `${room.is_featured ? '★ ' : ''}${room.name}`;
    mobile.addEventListener('click', () => switchRoom(room));
    ui.mobileRoomList.append(mobile);
  });
}
function roomImageUrl(room) {
  return room?.image_path ? supabase.storage.from('room-icons').getPublicUrl(room.image_path).data.publicUrl : '';
}
function renderRoomImageControls(room) {
  const url = roomImageUrl(room);
  ui.roomIcon.hidden = !url;
  if (url) paintAvatar(ui.roomIcon, room.name, url);
  const canEdit = canManageRoom(room);
  ui.roomImageButton.hidden = !canEdit;
  ui.roomImageRemove.hidden = !(canEdit && room.image_path);
  ui.roomImageButton.textContent = room.image_path ? '방 이미지 바꾸기' : '방 이미지 추가';
}
async function setRoomImage(file) {
  const room = state.room;
  if (!file || !room || !canManageRoom(room)) return;
  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
  if (!supportedTypes.includes(file.type)) return showToast('JPEG, PNG, WebP, GIF, AVIF 이미지만 쓸 수 있어요.');
  if (file.size > 12 * 1024 * 1024) return showToast('방 이미지는 12MB 이하로 선택해 주세요.');
  ui.roomImageButton.disabled = true;
  let path = null;
  try {
    const blob = await makeAvatarBlob(file, 256, 700 * 1024);
    const extension = ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' })[blob.type];
    path = `${room.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('room-icons').upload(path, blob, { contentType: blob.type, cacheControl: '3600', upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await supabase.rpc('roomchat_set_room_image', { p_room_id: room.id, p_image_path: path, p_owner_token: roomOwnerToken(room.id) });
    if (error) throw error;
    room.image_path = path;
    renderRoomImageControls(room);
    renderRoomLists();
    showToast('방 이미지를 바꿨어요.');
  } catch (error) {
    if (path) await supabase.storage.from('room-icons').remove([path]).catch(() => {});
    showToast(errorText(error, '방 이미지를 저장하지 못했어요. DB 업데이트(room_image_migration.sql)가 적용됐는지 확인해 주세요.'));
  } finally {
    ui.roomImageButton.disabled = false;
    ui.roomImageFile.value = '';
  }
}
async function removeRoomImage() {
  const room = state.room;
  if (!room || !canManageRoom(room) || !room.image_path) return;
  const { error } = await supabase.rpc('roomchat_set_room_image', { p_room_id: room.id, p_image_path: null, p_owner_token: roomOwnerToken(room.id) });
  if (error) return showToast(errorText(error, '방 이미지를 지우지 못했어요.'));
  room.image_path = null;
  renderRoomImageControls(room);
  renderRoomLists();
  showToast('방 이미지를 지웠어요.');
}
function updateRoomHeading(room) {
  renderRoomImageControls(room);
  updateComposerAvailability();
  ui.roomName.textContent = room.name;
  ui.bannerName.textContent = room.name;
  ui.roomTopic.textContent = room.name;
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
  if (ui.adminPanelDialog.open) renderAdminPanel();
}
function renderMessage(message) {
  const key = String(message.id);
  if (ui.messages.querySelector(`[data-message-id="${CSS.escape(key)}"]`)) return;
  ui.messages.querySelector('.empty-state, .loading-state')?.remove();
  const isOwn = isOwnMessage(message);
  const nickname = displayNickname(message.nickname || '익명', Boolean(message.is_verified));
  const mentioned = !isOwn && mentionsName(message.content, state.nickname);
  const row = document.createElement('article');
  row.className = `message-row${isOwn ? ' own-message' : ''}${message.is_verified ? ' verified-message' : ''}${mentioned ? ' mentioned' : ''}`;
  row.dataset.messageId = key;
  row.append(makeAvatar(nickname, message.user_id || null));
  const body = document.createElement('div');
  body.className = 'message-body';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const name = document.createElement('strong');
  name.className = `styled-name${message.is_verified ? ' admin-name' : ''}${message.user_id ? ' clickable' : ''}`;
  name.textContent = nickname;
  if (message.user_id) {
    name.dataset.styleUser = message.user_id;
    name.addEventListener('click', () => social?.openProfile(message.user_id));
  }
  meta.append(name);
  if (message.is_verified) addVerifiedMark(meta);
  if (message.user_id) {
    const slot = document.createElement('span');
    slot.className = 'tag-slot';
    slot.dataset.userId = message.user_id;
    meta.append(slot);
  }
  const time = document.createElement('time');
  time.dateTime = message.created_at;
  time.textContent = formatTime(message.created_at);
  meta.append(time);
  body.append(meta);
  const gifMatch = typeof message.content === 'string' ? message.content.match(GIF_URL_PATTERN) : null;
  if (gifMatch) {
    const gifLink = document.createElement('a');
    gifLink.className = 'message-image-link message-gif-link';
    gifLink.href = gifMatch[1];
    gifLink.target = '_blank';
    gifLink.rel = 'noopener noreferrer';
    gifLink.setAttribute('aria-label', 'GIF 원본 보기');
    const gif = document.createElement('img');
    gif.className = 'message-image message-gif';
    gif.src = gifMatch[1];
    gif.alt = 'GIPHY에서 보낸 GIF';
    gif.loading = 'lazy';
    gifLink.append(gif);
    body.append(gifLink);
  } else if (message.content) {
    const text = document.createElement('p');
    text.className = 'message-content';
    if (message.user_id) { text.dataset.styleUser = message.user_id; text.dataset.styleKind = 'text'; }
    text.append(renderMentions(message.content, getMentionNames(), state.nickname));
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
  if (state.isAdmin || isOwn) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'admin-action message-delete';
    remove.textContent = '삭제';
    remove.setAttribute('aria-label', '이 메시지 삭제');
    remove.addEventListener('click', () => deleteMessage(message));
    row.append(remove);
  }
  ui.messages.append(row);
  if (message.user_id) social?.applyProfileStyles();
}
function buildGuideCard() {
  const card = document.createElement('section');
  card.className = 'guide-card';
  card.setAttribute('aria-label', '사이트 소개');
  const title = document.createElement('h2');
  title.textContent = 'roomchat에 오신 걸 환영해요';
  const lead = document.createElement('p');
  lead.className = 'guide-lead';
  lead.textContent = '닉네임만 정하면 바로 참여할 수 있는 실시간 공개 채팅 서비스예요. 이 안내 방에서 주요 기능과 이용 방법을 빠르게 확인할 수 있어요.';
  const list = document.createElement('ul');
  list.className = 'guide-list';
  for (const [head, text] of [
    ['게스트 또는 계정', '게스트로 가볍게 시작하거나 닉네임과 비밀번호로 계정을 만들 수 있어요. 계정을 만들면 닉네임이 저장되어 다음에도 이어서 사용할 수 있어요.'],
    ['닉네임 규칙', '사용할 수 없거나 이미 사용 중인 닉네임은 안전한 대체 닉네임으로 자동 변경돼요.'],
    ['[인증됨] 관리자', '무지갯빛 닉네임과 [인증됨] 배지는 공식 관리자 계정에만 표시돼요. 다른 사용자가 직접 설정할 수 없어요.'],
    ['방 만들기', '누구나 공개 방을 만들 수 있어요. 방을 만든 사람은 해당 방의 운영자로서 참여자를 관리할 수 있어요.'],
    ['관리자의 정리', '운영진은 이용 규칙에 어긋나는 방과 닉네임, 메시지를 정리해 쾌적한 대화 환경을 유지해요.'],
    ['GIF · 사진 · 알림', 'GIF를 검색해 공유하고, 계정 프로필에 사진을 설정할 수 있어요. 알림을 켜면 새 메시지도 놓치지 않을 수 있어요.'],
  ]) {
    const item = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = head;
    item.append(strong, document.createTextNode(` ${text}`));
    list.append(item);
  }
  card.append(title, lead, list);
  return card;
}
function renderMessages() {
  ui.messages.replaceChildren();
  const guide = isGuideRoom(state.room);
  if (guide) ui.messages.append(buildGuideCard());
  if (!state.messages.length) {
    if (!guide) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<span class="empty-symbol">✳</span><strong>아직 첫 메시지가 없어요.</strong><span>먼저 가볍게 인사해보세요.</span>';
      ui.messages.append(empty);
    }
    return;
  }
  state.messages.forEach(renderMessage);
  ui.messages.scrollTop = guide ? 0 : ui.messages.scrollHeight;
  loadAvatars(state.messages.map((message) => message.user_id));
}
function addMessage(message) {
  if (state.messages.some((item) => String(item.id) === String(message.id))) return;
  loadAvatars([message.user_id]);
  state.messages.push(message);
  state.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  renderMessage(message);
  ui.messages.scrollTop = ui.messages.scrollHeight;
  if (ui.adminPanelDialog.open) renderAdminPanel();
}
function normalizeRpcRow(data) { return Array.isArray(data) ? data[0] : data; }
async function loadRooms() {
  const fetchRooms = (columns) => supabase.from('rooms').select(columns)
    .order('is_featured', { ascending: false }).order('created_at', { ascending: true }).limit(100);
  let { data, error } = await fetchRooms('id,name,created_at,created_by,is_featured,image_path');
  // 방 이미지 마이그레이션 전에도 방 목록은 보이도록 예전 열만으로 다시 시도합니다.
  if (error) ({ data, error } = await fetchRooms('id,name,created_at,created_by,is_featured'));
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
  const sidebarMembers = $('#sidebar-member-list');
  const sidebarMemberCount = $('#sidebar-member-count');
  if (sidebarMemberCount) sidebarMemberCount.textContent = String(members.length);
  if (sidebarMembers) sidebarMembers.replaceChildren();
  ui.membersNote.textContent = canManageRoom(state.room)
    ? '이 방의 관리자예요. 원하지 않는 참여자는 방에서 내보낼 수 있어요.'
    : '각 방을 만든 사람은 자기 방의 운영자로 참여자를 내보낼 수 있어요.';
  if (!members.length) {
    const empty = document.createElement('div');
    empty.className = 'member-empty';
    empty.textContent = '아직 함께 있는 사람이 없어요.';
    ui.memberList.append(empty);
    const sidebarEmpty = document.createElement('p');
    sidebarEmpty.className = 'sidebar-member-empty';
    sidebarEmpty.textContent = '아직 접속자가 없어요.';
    sidebarMembers?.append(sidebarEmpty);
    return;
  }
  members.sort((a, b) => String(a.nickname || '').localeCompare(String(b.nickname || ''), 'ko'));
  for (const member of members) {
    const rawNickname = typeof member.nickname === 'string' ? member.nickname : '익명';
    const verifiedAdmin = Boolean(member.isVerified);
    const nickname = displayNickname(rawNickname, verifiedAdmin);
    const row = document.createElement('div');
    row.className = 'member-row';
    row.append(makeAvatar(nickname, member.userId || null));
    const label = document.createElement('span');
    label.className = `member-name styled-name${verifiedAdmin ? ' admin-name' : ''}${member.userId ? ' clickable' : ''}`;
    label.textContent = nickname;
    if (member.userId) {
      label.dataset.styleUser = member.userId;
      label.addEventListener('click', () => social?.openProfile(member.userId));
    }
    row.append(label);
    if (verifiedAdmin) addVerifiedMark(row);
    if (member.userId) {
      const slot = document.createElement('span');
      slot.className = 'tag-slot';
      slot.dataset.userId = member.userId;
      row.append(slot);
    }
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
    if (sidebarMembers) {
      const sideRow = document.createElement('div');
      sideRow.className = 'sidebar-member-row';
      sideRow.append(makeAvatar(nickname, member.userId || null));
      const sideName = document.createElement('span');
      sideName.className = 'sidebar-member-name';
      sideName.textContent = nickname;
      sideRow.append(sideName);
      if (verifiedAdmin) {
        const mark = document.createElement('span');
        mark.className = 'verified-box';
        mark.textContent = '[인증됨]';
        sideRow.append(mark);
      }
      sidebarMembers.append(sideRow);
    }
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
  loadAvatars(state.members.map((member) => member.userId));
  renderMembers();
  if (ui.adminPanelDialog.open) renderAdminPanel();
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
        if (payload.eventType === 'INSERT' && !isOwnMessage(payload.new) && state.notifications) notifyIncoming(payload.new);
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
  if (ui.adminPanelDialog.open) renderAdminPanel();
}
async function createRoom(name) {
  const cleanName = [...name.trim().replace(/\s+/gu, ' ')].slice(0, 20).join('');
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
  applyAvatars();
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
  ui.adminPanelButton.hidden = !state.isAdmin;
  ui.avatarSection.hidden = !state.user;
  ui.styleOpen.hidden = !state.user;
  if (state.user) loadAvatars([state.user.id]);
  applyAvatars();
  if (!state.isAdmin && ui.adminPanelDialog.open) ui.adminPanelDialog.close();
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
    social?.stop();
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
  social?.start();
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
  if (state.pendingAdminInvite && !state.user) mode = 'register';
  state.accountMode = mode;
  ui.accountModeGroup.hidden = Boolean(state.pendingAdminInvite && !state.user);
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
  const required = state.accountMode === 'register' && ADMIN_INITIAL_NAMES.has(name);
  ui.adminCodeWrap.hidden = !required;
  ui.adminCode.required = required;
  const fromInvite = Boolean(state.pendingAdminInvite && state.pendingAdminInvite.nickname === name);
  ui.adminCode.readOnly = fromInvite;
  ui.adminCodeHelp.textContent = fromInvite
    ? '초대 링크가 확인됐어요. 일회용 코드가 가입 때 자동 적용됩니다.'
    : '관리자 최초 가입 이름은 천사 또는 크리스탈이에요. 이후 이름을 바꿔도 인증 배지는 유지되며, 코드는 1회만 사용돼요.';
  if (fromInvite) ui.adminCode.value = state.pendingAdminInvite.code;
  else if (!required) ui.adminCode.value = '';
}
function showNicknameDialog() {
  ui.nicknameEyebrow.textContent = state.user ? 'ACCOUNT NICKNAME' : 'GUEST MODE';
  ui.nicknameTitle.innerHTML = state.user ? '닉네임을<br />바꿀까요?' : '어떤 이름으로<br />인사할까요?';
  ui.nicknameDescription.textContent = state.user
    ? '계정 닉네임은 저장되어 다음에도 사용할 수 있어요. 관리자도 이름을 바꿀 수 있고 [인증됨] 표시는 유지돼요.'
    : '게스트 닉네임은 이 탭에서만 사용돼요. 계정을 만들면 닉네임이 저장되고 언제든 바꿀 수 있어요. 프로필 사진도 계정에서 지정할 수 있어요.';
  ui.avatarSection.hidden = !state.user;
  ui.styleOpen.hidden = !state.user;
  applyAvatars();
  ui.nicknameSubmit.innerHTML = `${state.user ? '닉네임 저장' : '게스트로 입장'} <span aria-hidden="true">↗</span>`;
  ui.nicknameInput.value = state.nickname;
  ui.accountOpen.hidden = Boolean(state.user);
  ui.signOut.hidden = !state.user;
  ui.nicknameDialog.showModal();
  window.setTimeout(() => ui.nicknameInput.focus(), 80);
}
function showAccountDialog() {
  setAccountMode('register');
  const invite = state.pendingAdminInvite && !state.user ? state.pendingAdminInvite : null;
  ui.accountNickname.readOnly = Boolean(invite);
  ui.accountNickname.value = invite?.nickname || (state.nickname && !state.user ? state.nickname : '');
  ui.accountPassword.value = '';
  ui.adminCode.value = invite?.code || '';
  updateAdminCodeVisibility();
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
  if (isGuideRoom(state.room)) return showToast('설명 방에서는 채팅할 수 없어요.');
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
    ui.send.classList.remove('sending');
    updateComposerAvailability();
    ui.messageInput.focus();
  }
}
async function enableNotifications() {
  if (!('Notification' in window)) return showToast('이 브라우저는 알림 기능을 지원하지 않아요.');
  if (Notification.permission === 'denied') return showToast('브라우저 설정에서 이 사이트의 알림을 허용해 주세요.');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return showToast('알림 권한이 허용되지 않았어요.');
  state.notifications = !state.notifications;
  if (state.notifications) { unlockAudio(); window.setTimeout(playMessageSound, 60); }
  ui.notificationButton.setAttribute('aria-pressed', String(state.notifications));
  ui.notificationButton.classList.toggle('enabled', state.notifications);
  ui.notificationLabel.textContent = state.notifications ? '알림 켜짐' : '알림 켜기';
  showToast(state.notifications ? '새 메시지 알림을 받을게요.' : '새 메시지 알림을 껐어요.');
}
let audioContext = null;
function unlockAudio() {
  // 브라우저는 사용자가 화면을 누른 뒤에만 소리를 허용하므로, 누를 때마다 오디오를 깨워 둡니다.
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext ||= new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch { /* Sound is optional. */ }
}
function playMessageSound() {
  try {
    if (!audioContext || audioContext.state !== 'running') return;
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.connect(audioContext.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    [[880, 0], [1175, 0.13]].forEach(([frequency, delay]) => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, now + delay);
      oscillator.connect(gain);
      oscillator.start(now + delay);
      oscillator.stop(now + delay + 0.22);
    });
  } catch { /* Sound is optional. */ }
}
async function showSystemNotification(title, body, tag) {
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.showNotification) {
      await registration.showNotification(title, { body, icon: './icon.svg', badge: './icon.svg', tag, data: { url: './' }, vibrate: [120, 60, 120] });
    } else new Notification(title, { body, icon: './icon.svg', tag });
  } catch { /* Notifications are an optional browser capability. */ }
}
// 알림 켜기를 누른 사람에게만 소리와 알림을 냅니다.
function notifyUser(title, body, tag) {
  if (!state.notifications) return;
  playMessageSound();
  showSystemNotification(title, body, tag);
}
async function notifyIncoming(message) {
  const mentioned = mentionsName(message.content, state.nickname);
  const author = displayNickname(message.nickname || '익명', Boolean(message.is_verified));
  const title = mentioned ? `${author}님이 회원님을 언급했어요 · ${state.room?.name || 'roomchat'}` : `${author} · ${state.room?.name || 'roomchat'}`;
  const body = GIF_URL_PATTERN.test(message.content || '') ? 'GIF를 보냈어요.' : (message.content || '사진을 공유했어요.');
  playMessageSound();
  await showSystemNotification(title, body, `roomchat-${message.id}`);
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
  const own = isOwnMessage(message);
  if ((!state.isAdmin && !own) || !window.confirm(own && !state.isAdmin ? '내가 보낸 메시지를 삭제할까요?' : '이 메시지를 삭제할까요?')) return;
  try {
    if (state.isAdmin) {
      if (message.image_path) await removeImages([message.image_path]);
      const { error } = await supabase.rpc('roomchat_admin_delete_message', { p_message_id: message.id });
      if (error) throw error;
    } else {
      // 내 메시지의 사진은 계정 사용자만 지울 수 있어서, 실패해도 메시지 삭제는 계속합니다.
      if (message.image_path) await removeImages([message.image_path]).catch(() => {});
      const { error } = await supabase.rpc('roomchat_delete_my_message', {
        p_message_id: message.id,
        p_guest_session_id: state.user ? null : guestSessionId,
        p_guest_token: state.user ? null : guestToken,
      });
      if (error) throw error;
    }
    removeMessage(message.id);
    if (state.isAdmin) renderAdminPanel();
    showToast('메시지를 삭제했어요.');
  } catch (error) { showToast(errorText(error, '메시지를 삭제하지 못했어요.')); }
}
async function deleteRoomRecord(room) {
  if (!state.isAdmin || !room || room.is_featured) return;
  if (!window.confirm(`“${room.name}” 방과 그 방의 메시지 기록을 삭제할까요?`)) return;
  try {
    const { data: paths, error: pathError } = await supabase.rpc('roomchat_admin_room_image_paths', { p_room_id: room.id });
    if (pathError) throw pathError;
    await removeImages(paths || []);
    const { error } = await supabase.rpc('roomchat_admin_delete_room', { p_room_id: room.id });
    if (error) throw error;
    state.rooms = state.rooms.filter((item) => item.id !== room.id);
    renderRoomLists();
    if (state.room?.id === room.id) {
      const fallback = sortedRooms().find((item) => item.is_featured) || sortedRooms()[0];
      state.room = null;
      if (fallback) await switchRoom(fallback);
    }
    renderAdminPanel();
    showToast('방과 메시지를 삭제했어요.');
  } catch (error) { showToast(errorText(error, '방을 삭제하지 못했어요.')); }
}
async function deleteRoom() { return deleteRoomRecord(state.room); }
function chooseKickMinutes(name) {
  return new Promise((resolve) => {
    ui.kickTarget.textContent = name || '이 참여자';
    let chosen = null;
    const onClick = (event) => {
      const button = event.target.closest('[data-kick-minutes]');
      if (button) { chosen = Number(button.dataset.kickMinutes); ui.kickDialog.close(); return; }
      if (event.target.closest('[data-kick-cancel]') || event.target === ui.kickDialog) ui.kickDialog.close();
    };
    ui.kickDialog.addEventListener('click', onClick);
    ui.kickDialog.addEventListener('close', () => { ui.kickDialog.removeEventListener('click', onClick); resolve(chosen); }, { once: true });
    ui.kickDialog.showModal();
  });
}
const KICK_LABELS = { 1: '1분', 5: '5분', 1440: '하루' };
async function kickMember(member) {
  if (!canManageRoom(state.room)) return showToast('이 방의 운영자만 참여자를 내보낼 수 있어요.');
  const minutes = await chooseKickMinutes(member.nickname);
  if (!minutes) return;
  const args = {
    p_room_id: state.room.id,
    p_user_id: member.userId || null,
    p_guest_session_id: member.userId ? null : member.guestSessionId,
    p_owner_token: roomOwnerToken(state.room.id),
  };
  let { error } = await supabase.rpc('roomchat_kick_member', { ...args, p_minutes: minutes });
  // 시간 선택 마이그레이션 전에는 예전 방식(영구 추방)으로 호출되므로, 그 경우는 시도하지 않고 안내만 합니다.
  if (error && (error.code === 'PGRST202' || /p_minutes|schema cache/u.test(String(error.message)))) {
    return showToast('내보내기 시간 설정을 쓰려면 DB 업데이트(social_migration.sql)가 먼저 필요해요.');
  }
  if (error) return showToast(errorText(error, '참여자를 내보내지 못했어요.'));
  showToast(`${member.nickname || '참여자'}님을 ${KICK_LABELS[minutes]} 동안 내보냈어요.`);
  await refreshMembers();
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
function cleanGiphyUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^media\d*\.giphy\.com$/u.test(url.hostname)) return null;
    if (!/^\/media\/[A-Za-z0-9_\-/.]+\.gif$/u.test(url.pathname)) return null;
    return `${url.origin}${url.pathname}`;
  } catch { return null; }
}
async function loadGifs(query = '') {
  const request = ++state.gifRequest;
  ui.gifGrid.replaceChildren();
  if (!GIPHY_API_KEY) {
    ui.gifStatus.textContent = 'GIF 검색은 GIPHY API 키를 설정하면 사용할 수 있어요. (config.js의 GIPHY_API_KEY)';
    return;
  }
  ui.gifStatus.textContent = query ? `“${query}” 검색 중…` : '인기 GIF를 불러오는 중…';
  const params = new URLSearchParams({ api_key: GIPHY_API_KEY, limit: '24', rating: 'g', lang: 'ko' });
  if (query) params.set('q', query);
  try {
    const response = await fetch(`https://api.giphy.com/v1/gifs/${query ? 'search' : 'trending'}?${params}`);
    if (!response.ok) throw new Error('giphy');
    const result = await response.json();
    if (request !== state.gifRequest) return;
    const items = (result.data || []).map((item) => ({
      title: String(item.title || 'GIF').slice(0, 80),
      preview: cleanGiphyUrl(item.images?.fixed_width_small?.url || item.images?.fixed_width?.url),
      send: cleanGiphyUrl(item.images?.downsized_medium?.url || item.images?.fixed_height?.url || item.images?.original?.url),
    })).filter((item) => item.preview && item.send);
    ui.gifStatus.textContent = items.length ? (query ? `“${query}” 검색 결과` : '인기 GIF') : '검색 결과가 없어요. 다른 단어로 찾아보세요.';
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gif-item';
      button.setAttribute('aria-label', `${item.title} 보내기`);
      const image = document.createElement('img');
      image.src = item.preview;
      image.alt = item.title;
      image.loading = 'lazy';
      button.append(image);
      button.addEventListener('click', () => sendGif(item.send));
      ui.gifGrid.append(button);
    }
  } catch {
    if (request === state.gifRequest) ui.gifStatus.textContent = 'GIF를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}
function openGifDialog() {
  if (!state.nickname) { showNicknameDialog(); return; }
  if (!state.room) return showToast('먼저 채팅방을 선택해 주세요.');
  ui.gifQuery.value = '';
  ui.gifDialog.showModal();
  loadGifs('');
  if (!window.matchMedia('(pointer: coarse)').matches) window.setTimeout(() => ui.gifQuery.focus(), 80);
}
async function sendGif(url) {
  if (isGuideRoom(state.room)) return showToast('설명 방에서는 GIF를 보낼 수 없어요.');
  const clean = cleanGiphyUrl(url);
  if (!clean || !state.room || !state.nickname) return;
  ui.gifDialog.close();
  try {
    const { data, error } = await supabase.rpc('roomchat_post_message', {
      p_room_id: state.room.id,
      p_content: `${GIF_PREFIX}${clean}`,
      p_image_path: null,
      p_guest_session_id: state.user ? null : guestSessionId,
      p_guest_token: state.user ? null : guestToken,
    });
    if (error) throw error;
    const inserted = normalizeRpcRow(data);
    if (inserted) addMessage(inserted);
  } catch (error) { showToast(errorText(error, 'GIF를 보내지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.')); }
}

async function makeAvatarBlob(file, size = AVATAR_SIZE, maxBytes = 900 * 1024) {
  let bitmap = null;
  let objectUrl = '';
  let source;
  try {
    bitmap = await createImageBitmap(file);
    source = bitmap;
  } catch {
    objectUrl = URL.createObjectURL(file);
    source = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('이미지를 읽지 못했어요.'));
      image.src = objectUrl;
    });
  }
  try {
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error('이미지를 읽지 못했어요.');
    const side = Math.min(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d').drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
    for (const [type, quality] of [['image/webp', 0.86], ['image/jpeg', 0.86]]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
      if (blob && blob.type === type && blob.size <= maxBytes) return blob;
    }
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (png && png.size <= maxBytes) return png;
    throw new Error('이미지를 줄이지 못했어요.');
  } finally {
    bitmap?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
async function setAvatarFromFile(file) {
  if (!file) return;
  if (!state.user) return showToast('프로필 사진은 계정을 만들면 지정할 수 있어요.');
  if (state.avatarBusy) return;
  if (!AVATAR_INPUT_TYPES.includes(file.type)) return showToast('JPEG, PNG, WebP, GIF, AVIF 이미지만 사용할 수 있어요.');
  if (file.size > 12 * 1024 * 1024) return showToast('프로필 사진은 12MB 이하로 선택해 주세요.');
  state.avatarBusy = true;
  ui.avatarDrop.classList.add('busy');
  let path = null;
  try {
    const blob = await makeAvatarBlob(file);
    const extension = ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' })[blob.type];
    path = `${state.user.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, blob, {
      contentType: blob.type, cacheControl: '3600', upsert: false,
    });
    if (uploadError) throw uploadError;
    const { data: previous, error } = await supabase.rpc('roomchat_set_my_avatar', { p_path: path });
    if (error) throw error;
    if (previous && previous !== path) supabase.storage.from('avatars').remove([previous]).catch(() => {});
    state.avatars.set(state.user.id, avatarPublicUrl(path));
    applyAvatars();
    showToast('프로필 사진을 바꿨어요.');
  } catch (error) {
    if (path) await supabase.storage.from('avatars').remove([path]).catch(() => {});
    showToast(errorText(error, '프로필 사진을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'));
  } finally {
    state.avatarBusy = false;
    ui.avatarDrop.classList.remove('busy');
    ui.avatarFile.value = '';
  }
}
async function removeAvatar() {
  if (!state.user || state.avatarBusy) return;
  state.avatarBusy = true;
  try {
    const { data: previous, error } = await supabase.rpc('roomchat_set_my_avatar', { p_path: null });
    if (error) throw error;
    if (previous) supabase.storage.from('avatars').remove([previous]).catch(() => {});
    state.avatars.set(state.user.id, '');
    applyAvatars();
    showToast('프로필 사진을 지웠어요.');
  } catch (error) { showToast(errorText(error, '프로필 사진을 지우지 못했어요.')); }
  finally { state.avatarBusy = false; }
}
function openMembers() {
  renderMembers();
  ui.membersDialog.showModal();
  refreshMembers();
}
function panelElement(tag, className, text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}
function panelAction(label, className, handler) {
  const button = panelElement('button', `admin-action admin-panel-action ${className || ''}`, label);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}
function renderAdminPanel() {
  if (!state.isAdmin) return;
  ui.adminPanelSummary.replaceChildren();
  const metrics = [
    ['공개 방', state.rooms.length],
    ['현재 방 참여자', state.members.length],
    ['불러온 메시지', state.messages.length],
  ];
  for (const [label, value] of metrics) {
    const card = panelElement('div', 'admin-metric');
    card.append(panelElement('strong', '', String(value)), panelElement('span', '', label));
    ui.adminPanelSummary.append(card);
  }
  document.querySelectorAll('[data-admin-panel-tab]').forEach((tab) => {
    const active = tab.dataset.adminPanelTab === state.adminPanelTab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  ui.adminPanelContent.replaceChildren();
  if (state.adminPanelTab === 'overview') {
    ui.adminPanelContent.append(
      panelElement('h3', 'admin-panel-section-title', '빠른 관리'),
      panelElement('p', 'admin-panel-note', `현재 방: ${state.room?.name || '선택된 방 없음'} · 관리자 초대 링크는 역할별 1회만 사용할 수 있어요.`),
    );
    const shortcuts = panelElement('div', 'admin-shortcuts');
    for (const [tab, label, detail] of [
      ['rooms', '방 관리', '방을 열거나 고정 기본방을 제외한 방을 삭제합니다.'],
      ['members', '참여자 관리', '현재 방에서 닉네임을 정리하거나 참여자를 내보냅니다.'],
      ['messages', '메시지 관리', '현재 방에 불러온 최근 메시지를 검토하고 삭제합니다.'],
    ]) {
      const shortcut = panelElement('button', 'admin-shortcut');
      shortcut.type = 'button';
      shortcut.append(panelElement('strong', '', label), panelElement('span', '', detail), panelElement('i', '', '↗'));
      shortcut.addEventListener('click', () => { state.adminPanelTab = tab; renderAdminPanel(); });
      shortcuts.append(shortcut);
    }
    ui.adminPanelContent.append(shortcuts);
    return;
  }
  if (state.adminPanelTab === 'rooms') {
    ui.adminPanelContent.append(panelElement('h3', 'admin-panel-section-title', '모든 공개 방'));
    const list = panelElement('div', 'admin-panel-list');
    if (!state.rooms.length) list.append(panelElement('p', 'admin-panel-empty', '표시할 방이 없습니다.'));
    sortedRooms().forEach((room) => {
      const row = panelElement('article', 'admin-panel-row');
      const copy = panelElement('div', 'admin-panel-row-copy');
      copy.append(panelElement('strong', '', room.name), panelElement('span', 'admin-panel-row-meta', room.is_featured ? '고정 기본방 · 삭제 보호' : '공개 방'));
      const actions = panelElement('div', 'admin-panel-row-actions');
      actions.append(panelAction('열기', '', async () => { await switchRoom(room); renderAdminPanel(); }));
      if (!room.is_featured) actions.append(panelAction('삭제', 'danger-action', () => deleteRoomRecord(room)));
      row.append(copy, actions);
      list.append(row);
    });
    ui.adminPanelContent.append(list);
    return;
  }
  if (state.adminPanelTab === 'members') {
    ui.adminPanelContent.append(panelElement('h3', 'admin-panel-section-title', `참여자 · ${state.room?.name || '방 미선택'}`));
    const list = panelElement('div', 'admin-panel-list');
    if (!state.room) list.append(panelElement('p', 'admin-panel-empty', '먼저 방을 선택해 주세요.'));
    else if (!state.members.length) list.append(panelElement('p', 'admin-panel-empty', '현재 함께 있는 참여자가 없습니다.'));
    for (const member of state.members) {
      const row = panelElement('article', 'admin-panel-row');
      const copy = panelElement('div', 'admin-panel-row-copy');
      copy.append(panelElement('strong', member.isVerified ? 'admin-name' : '', displayNickname(member.nickname || '익명', member.isVerified)), panelElement('span', 'admin-panel-row-meta', member.isVerified ? '[인증됨] 관리자' : member.userId ? '계정' : '게스트'));
      const actions = panelElement('div', 'admin-panel-row-actions');
      if (!member.isVerified) {
        actions.append(panelAction('이름 정리', '', () => moderateNickname(member)));
        actions.append(panelAction('내보내기', 'danger-action', () => kickMember(member)));
      }
      row.append(copy, actions);
      list.append(row);
    }
    ui.adminPanelContent.append(list);
    return;
  }
  ui.adminPanelContent.append(panelElement('h3', 'admin-panel-section-title', `최근 메시지 · ${state.room?.name || '방 미선택'}`));
  const list = panelElement('div', 'admin-panel-list');
  const recentMessages = [...state.messages].slice(-50).reverse();
  if (!state.room) list.append(panelElement('p', 'admin-panel-empty', '먼저 방을 선택해 주세요.'));
  else if (!recentMessages.length) list.append(panelElement('p', 'admin-panel-empty', '현재 방에 불러온 메시지가 없습니다.'));
  for (const message of recentMessages) {
    const row = panelElement('article', 'admin-panel-row');
    const copy = panelElement('div', 'admin-panel-row-copy');
    const nickname = displayNickname(message.nickname || '익명', Boolean(message.is_verified));
    const meta = `${nickname}${message.is_verified ? ' · 관리자' : ''} · ${formatTime(message.created_at)}`;
    copy.append(panelElement('strong', message.is_verified ? 'admin-name' : '', meta), panelElement('span', 'admin-panel-row-meta', (message.content || (message.image_path ? '[이미지 첨부]' : '[내용 없음]')).slice(0, 140)));
    row.append(copy, panelAction('삭제', 'danger-action', () => deleteMessage(message)));
    list.append(row);
  }
  ui.adminPanelContent.append(list);
}
function openAdminPanel() {
  if (!state.isAdmin) return;
  state.adminPanelTab = 'overview';
  renderAdminPanel();
  ui.adminPanelDialog.showModal();
  if (state.room) refreshMembers().then(renderAdminPanel);
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
  $('#sidebar-account-settings')?.addEventListener('click', () => ui.nicknameButton.click());
  $('#sidebar-invite-button')?.addEventListener('click', openRoomDialog);
  $('#sidebar-welcome-close')?.addEventListener('click', () => { const card = $('#sidebar-welcome-card'); if (card) card.hidden = true; });
  $('#nickname-close')?.addEventListener('click', () => ui.nicknameDialog.close());
  ui.accountOpen.addEventListener('click', () => { ui.nicknameDialog.close(); showAccountDialog(); });
  ui.styleOpen.addEventListener('click', () => { ui.nicknameDialog.close(); social?.openStyleDialog(); });
  ui.signOut.addEventListener('click', async () => {
    await supabase.auth.signOut();
    await applySession(null);
    ui.nicknameDialog.close();
    showToast('로그아웃했어요. 이번 탭에서 게스트로 계속 이용할 수 있어요.');
    showNicknameDialog();
  });
  $('#new-room-button').addEventListener('click', openRoomDialog);
  $('#rail-new-room')?.addEventListener('click', openRoomDialog);
  $('#mobile-new-room-button').addEventListener('click', openRoomDialog);
  $('#cancel-room').addEventListener('click', () => ui.roomDialog.close());
  ui.roomImageButton.addEventListener('click', () => ui.roomImageFile.click());
  ui.roomImageRemove.addEventListener('click', removeRoomImage);
  ui.roomImageFile.addEventListener('change', (event) => setRoomImage(event.target.files?.[0]));
  ui.roomBanner.addEventListener('dragover', (event) => { if (canManageRoom(state.room)) event.preventDefault(); });
  ui.roomBanner.addEventListener('drop', (event) => {
    if (!canManageRoom(state.room)) return;
    event.preventDefault();
    setRoomImage([...(event.dataTransfer?.files || [])].find((file) => file.type.startsWith('image/')));
  });
  ui.roomForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = ui.roomInput.value.trim();
    ui.roomDialog.close();
    createRoom(value);
  });
  ui.roomDelete.addEventListener('click', deleteRoom);
  ui.adminPanelButton.addEventListener('click', openAdminPanel);
  ui.adminPanelClose.addEventListener('click', () => ui.adminPanelDialog.close());
  document.querySelectorAll('[data-admin-panel-tab]').forEach((tab) => tab.addEventListener('click', () => {
    state.adminPanelTab = tab.dataset.adminPanelTab;
    renderAdminPanel();
    if (state.adminPanelTab === 'members' && state.room) refreshMembers().then(renderAdminPanel);
  }));
  ui.adminPanelDialog.addEventListener('click', (event) => {
    if (event.target === ui.adminPanelDialog) ui.adminPanelDialog.close();
  });
  ui.presenceButton.addEventListener('click', openMembers);
  ui.membersClose.addEventListener('click', () => ui.membersDialog.close());
  ui.notificationButton.addEventListener('click', enableNotifications);
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  ui.gifButton.addEventListener('click', openGifDialog);
  ui.gifClose.addEventListener('click', () => ui.gifDialog.close());
  ui.gifDialog.addEventListener('click', (event) => { if (event.target === ui.gifDialog) ui.gifDialog.close(); });
  ui.gifForm.addEventListener('submit', (event) => { event.preventDefault(); loadGifs(ui.gifQuery.value.trim()); });
  ui.avatarFile.addEventListener('change', (event) => setAvatarFromFile(event.target.files?.[0]));
  ui.avatarRemove.addEventListener('click', removeAvatar);
  ui.avatarDrop.addEventListener('click', () => ui.avatarFile.click());
  ui.avatarDrop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); ui.avatarFile.click(); }
  });
  ['dragenter', 'dragover'].forEach((name) => ui.avatarDrop.addEventListener(name, (event) => {
    event.preventDefault();
    ui.avatarDrop.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((name) => ui.avatarDrop.addEventListener(name, () => ui.avatarDrop.classList.remove('dragging')));
  ui.avatarDrop.addEventListener('drop', (event) => {
    event.preventDefault();
    setAvatarFromFile([...(event.dataTransfer?.files || [])].find((file) => file.type.startsWith('image/')));
  });
  // 닉네임 창이 열려 있을 때 Ctrl+V(또는 길게 눌러 붙여넣기)로 복사한 이미지를 프로필 사진으로 사용합니다.
  document.addEventListener('paste', (event) => {
    if (!ui.nicknameDialog.open || !state.user) return;
    const file = [...(event.clipboardData?.items || [])].find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    if (!file) return;
    event.preventDefault();
    setAvatarFromFile(file);
  });
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
    const invite = state.pendingAdminInvite && !state.user ? state.pendingAdminInvite : null;
    const name = [...(invite?.nickname || ui.accountNickname.value.normalize('NFC').trim().replace(/\s+/gu, ' '))].slice(0, 20).join('');
    const password = ui.accountPassword.value;
    const code = invite?.code || ui.adminCode.value.trim();
    const action = invite ? 'register' : state.accountMode;
    if (password.length < 8 || new TextEncoder().encode(password).length > 72) return showToast('비밀번호는 8~72바이트로 입력해 주세요.');
    ui.accountSubmit.disabled = true;
    try {
      const result = await callAuth(action, name, password, code);
      if (invite) clearAdminInvite();
      ui.accountPassword.value = '';
      ui.adminCode.value = '';
      ui.accountDialog.close();
      ui.nicknameDialog.close();
      if (result.nickname !== name) showToast(`사용할 수 없거나 이미 사용 중인 이름이라 “${result.nickname}”로 저장했어요.`);
      else showToast(action === 'register' ? '계정을 만들고 로그인했어요. 닉네임은 저장됩니다.' : '로그인했어요.');
      if (state.room) { const current = state.room; state.room = null; await switchRoom(current); }
    } catch (error) { showToast(errorText(error, '계정을 확인하지 못했어요.')); }
    finally { ui.accountSubmit.disabled = false; }
  });
  ui.accountCancel.addEventListener('click', () => { ui.accountDialog.close(); showNicknameDialog(); });
}

async function boot() {
  restoreAdminInvite();
  setupEvents();
  registerServiceWorker();
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) await applySession(data.session);
  } catch (error) { console.warn('Could not restore account session'); }
  if (state.user && state.pendingAdminInvite) clearAdminInvite();
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms' }, ({ new: room }) => {
        const existing = state.rooms.find((item) => item.id === room.id);
        if (!existing) return;
        Object.assign(existing, room);
        renderRoomLists();
        if (state.room?.id === room.id) renderRoomImageControls(state.room);
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
  if (!state.user && state.pendingAdminInvite) showAccountDialog();
  else if (!state.user && !state.nickname) showNicknameDialog();
  state.identityTimer = window.setInterval(refreshIdentity, 45000);
}

social = initSocial({
  supabase, state, showToast, errorText, avatarPublicUrl, paintAvatar, makeAvatar, applyAvatars,
  makeAvatarBlob, notifyUser, getMentionNames,
});
boot();
