import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, GIPHY_API_KEY } from './config.js?v=20261018-giphy';
import { initSocial, renderMentions, mentionsName } from './social.js?v=20261021-mobile-touch-v2';
import { ensureFont, fontStack } from './fonts.js?v=20261020-social';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  realtime: { params: { eventsPerSecond: 8 } },
});
const $ = (selector) => document.querySelector(selector);
const ui = {
  mentionPopup: $('#mention-popup'),
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
  roomDelete: $('#room-delete-button'), childRoomButton: $('#new-child-room-button'), roomUnlimitedChoice: $('#room-unlimited-choice'), membersDialog: $('#members-dialog'), memberList: $('#member-list'),
  membersNote: $('#members-note'), membersClose: $('#members-close-button'), notificationButton: $('#notification-button'),
  notificationLabel: $('#notification-label'), messageForm: $('#message-form'), messageInput: $('#message-input'),
  send: $('#send-button'), imageFile: $('#image-file'), preview: $('#attachment-preview'),
  thumbnail: $('#attachment-thumbnail'), attachmentName: $('#attachment-name'), removeAttachment: $('#remove-attachment'),
  toast: $('#toast'), charCount: $('#char-count'),
  messageSearch: $('#message-search'), messageSearchDate: $('#message-search-date'), messageSearchClear: $('#message-search-clear'),
  chatSettingsButton: $('#chat-settings-button'), chatSettings: $('#chat-settings'),
  chatSettingsClose: $('#chat-settings-close'), resetChatSettings: $('#reset-chat-settings'),
  settingDark: $('#setting-dark'), settingFontSize: $('#setting-font-size'),
  settingWide: $('#setting-wide'), settingHideSidebar: $('#setting-hide-sidebar'), settingYouTubePreview: $('#setting-youtube-preview'),
  sidebarCollapseButton: $('#sidebar-collapse-button'),
  settingSound: $('#setting-sound'), clearNotificationHistory: $('#clear-notification-history'),
  notificationHistoryList: $('#notification-history-list'),
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
  replyPreview: $('#reply-preview'), replyPreviewName: $('#reply-preview-name'),
  replyPreviewContent: $('#reply-preview-content'), cancelReply: $('#cancel-reply'),
};
const GUEST_ID_KEY = 'roomchat:guest-id';
const GUEST_TOKEN_KEY = 'roomchat:guest-token';
const ROOM_OWNER_PREFIX = 'roomchat:owner:';
const ROOM_FAVORITES_KEY = 'roomchat:room-favorites:v1';
const FIXED_ROOM_NAME = '슬랩배틀 라이벌 입양 피기';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ADMIN_INITIAL_NAMES = new Set(['천사', '크리스탈']);
const GUIDE_ROOM_NAME = '설명 방';
const GIF_PREFIX = '[gif]';
// 서버는 내용을 검사하지 않으므로, 화면에는 GIPHY 미디어 주소만 그림으로 그립니다.
const GIF_URL_PATTERN = /^\[gif\](https:\/\/media\d*\.giphy\.com\/media\/[A-Za-z0-9_\-/.]+\.(gif|webp))$/iu;
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
  accountMode: 'register', adminPanelTab: 'overview', pendingAdminInvite: null, pendingParentRoomId: null, pendingUnlimitedMessages: false,
  avatars: new Map(), myAvatarPath: null, avatarBusy: false, gifRequest: 0,
  profiles: new Map(), messageSearchQuery: '', messageSearchDate: '', soundEnabled: true, notificationHistory: [], messageReactions: new Map(), replyTarget: null, pinnedMessageIds: new Set(), unreadRoomMessages: 0, newMessageDividerId: null, typingLastSentAt: 0, typingClearTimer: 0,
};
let social = null;
let roomSearchQuery = '';
let remoteTypingName = '';
const typingIndicator = document.createElement('div');
typingIndicator.className = 'typing-indicator'; typingIndicator.hidden = true; typingIndicator.setAttribute('aria-live', 'polite');
const unreadMessagesButton = document.createElement('button');
unreadMessagesButton.type = 'button'; unreadMessagesButton.className = 'unread-messages-button'; unreadMessagesButton.hidden = true;
unreadMessagesButton.addEventListener('click', () => { ui.messages.scrollTo({ top: ui.messages.scrollHeight, behavior: 'smooth' }); clearUnreadRoomMessages(); });
ui.messages.parentElement.append(unreadMessagesButton);
ui.messageForm.parentElement.insertBefore(typingIndicator, ui.messageForm);
function updateUnreadRoomMessages() {
  unreadMessagesButton.textContent = state.unreadRoomMessages ? `새 메시지 ${state.unreadRoomMessages}개 · 아래로 이동` : '';
  unreadMessagesButton.hidden = !state.unreadRoomMessages;
}
function clearUnreadRoomMessages() {
  state.unreadRoomMessages = 0; state.newMessageDividerId = null; updateUnreadRoomMessages();
  ui.messages.querySelector('.new-message-divider')?.remove();
}
function showRemoteTyping(name) {
  remoteTypingName = String(name || '누군가').slice(0, 30);
  typingIndicator.textContent = `${remoteTypingName} 입력 중…`;
  typingIndicator.hidden = false;
  window.clearTimeout(state.typingClearTimer);
  state.typingClearTimer = window.setTimeout(() => { typingIndicator.hidden = true; remoteTypingName = ''; }, 3000);
}
let mediaOnlyMode = false;
const imageZoomDialog = document.createElement('dialog');
imageZoomDialog.className = 'image-zoom-dialog';
imageZoomDialog.setAttribute('aria-label', '이미지 크게 보기');
const imageZoomClose = document.createElement('button');
imageZoomClose.type = 'button'; imageZoomClose.className = 'image-zoom-close'; imageZoomClose.textContent = '닫기'; imageZoomClose.setAttribute('aria-label', '이미지 보기 닫기');
const imageZoomImage = document.createElement('img');
imageZoomImage.className = 'image-zoom-content'; imageZoomImage.alt = '확대된 채팅 이미지';
imageZoomDialog.append(imageZoomClose, imageZoomImage);
document.body.append(imageZoomDialog);
function openImageZoom(url, alt) {
  if (!url) return;
  imageZoomImage.src = url;
  imageZoomImage.alt = alt || '확대된 채팅 이미지';
  if (!imageZoomDialog.open) imageZoomDialog.showModal();
}
function closeImageZoom() { if (imageZoomDialog.open) imageZoomDialog.close(); imageZoomImage.removeAttribute('src'); }
imageZoomClose.addEventListener('click', closeImageZoom);
imageZoomDialog.addEventListener('click', (event) => { if (event.target === imageZoomDialog) closeImageZoom(); });
imageZoomDialog.addEventListener('close', () => imageZoomImage.removeAttribute('src'));
const mediaGalleryButton = document.createElement('button');
mediaGalleryButton.type = 'button';
mediaGalleryButton.className = 'secondary-button media-gallery-toggle';
mediaGalleryButton.textContent = '미디어 모아보기';
mediaGalleryButton.setAttribute('aria-pressed', 'false');
mediaGalleryButton.addEventListener('click', () => {
  mediaOnlyMode = !mediaOnlyMode;
  mediaGalleryButton.textContent = mediaOnlyMode ? '전체 메시지 보기' : '미디어 모아보기';
  mediaGalleryButton.setAttribute('aria-pressed', String(mediaOnlyMode));
  renderMessages();
});
ui.messageSearch?.parentElement?.append(mediaGalleryButton);
let roomFavorites = new Set((() => { try { const value = JSON.parse(localStorage.getItem(ROOM_FAVORITES_KEY) || '[]'); return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []; } catch { return []; } })());
const roomSearchInput = document.createElement('input');
roomSearchInput.type = 'search';
roomSearchInput.className = 'text-field room-search-input';
roomSearchInput.placeholder = '방 이름 검색';
roomSearchInput.setAttribute('aria-label', '채팅방 검색');
roomSearchInput.autocomplete = 'off';
roomSearchInput.addEventListener('input', () => { roomSearchQuery = roomSearchInput.value.trim().toLocaleLowerCase(); renderRoomLists(); });
ui.roomList.parentElement.insertBefore(roomSearchInput, ui.roomList);
function toggleRoomFavorite(room) {
  if (roomFavorites.has(room.id)) roomFavorites.delete(room.id); else roomFavorites.add(room.id);
  try { localStorage.setItem(ROOM_FAVORITES_KEY, JSON.stringify([...roomFavorites])); } catch {}
  renderRoomLists();
}
let mentionItems = [];
let mentionActiveIndex = 0;
let mentionToken = null;

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
function errorText(error, fallback = '요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.') {
  const text = String(error?.message || '');
  // 서버가 직접 만든 안내 문구는 한국어라서 그대로 보여주고, 영어 시스템 오류는 숨깁니다.
  return /[가-힣]/u.test(text) ? text : fallback;
}
function setConnection(connected, label = connected ? '실시간 연결됨' : '연결 중') {
  ui.connection.classList.toggle('online', connected);
  ui.connection.classList.toggle('offline', !connected);
  ui.connection.setAttribute('role', 'status');
  ui.connection.setAttribute('aria-label', label);
  const textNode = [...ui.connection.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  const labelNode = ui.connection.querySelector('.connection-label');
  if (labelNode) labelNode.textContent = label;
  else if (textNode) textNode.textContent = ` ${label}`;
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
  ui.messageInput.placeholder = guide ? '안내 채널에서는 메시지를 보낼 수 없어요.' : '메시지를 입력하세요…';
  ui.send.disabled = guide || ui.send.classList.contains('sending');
  ui.imageFile.disabled = guide;
  ui.gifButton.disabled = guide;
  const imageButton = ui.messageForm.querySelector('label[for="image-file"]');
  if (imageButton) imageButton.hidden = guide;
  const footnote = ui.messageForm.parentElement.querySelector('.composer-foot span');
  if (footnote) footnote.textContent = guide ? '안내 전용 채널 · 메시지 전송 불가' : 'Enter 전송 · Shift + Enter 줄바꿈';
}
const ROOM_ORDER_KEY = 'roomchat:room-order:v1';
function savedRoomOrder() {
  try {
    const value = JSON.parse(localStorage.getItem(ROOM_ORDER_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
  } catch { return []; }
}
function sortedRooms() {
  const order = savedRoomOrder();
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...state.rooms].sort((a, b) => {
    const guideDiff = Number(isGuideRoom(b)) - Number(isGuideRoom(a));
    if (guideDiff) return guideDiff;
    // Preserve parent/child grouping; users can reorder top-level rooms only.
    if (Boolean(a.parent_id) !== Boolean(b.parent_id)) return Number(Boolean(a.parent_id)) - Number(Boolean(b.parent_id));
    const aFavorite = roomFavorites.has(a.id);
    const bFavorite = roomFavorites.has(b.id);
    if (aFavorite !== bFavorite) return Number(bFavorite) - Number(aFavorite);
    const aRank = rank.get(a.id);
    const bRank = rank.get(b.id);
    if (aRank !== undefined || bRank !== undefined) {
      if (aRank === undefined) return 1;
      if (bRank === undefined) return -1;
      if (aRank !== bRank) return aRank - bRank;
    }
    return Number(Boolean(b.is_featured)) - Number(Boolean(a.is_featured))
      || new Date(a.created_at) - new Date(b.created_at);
  });
}
function renderRoomLists() {
  ui.roomList.replaceChildren();
  ui.mobileRoomList.replaceChildren();
  const railRooms = $('#rail-room-list');
  railRooms?.replaceChildren();
  const allRooms = sortedRooms();
  const query = roomSearchQuery;
  const matchingIds = new Set(allRooms.filter((room) => !query || room.name.toLocaleLowerCase().includes(query)).map((room) => room.id));
  for (const room of allRooms) {
    if (room.parent_id && matchingIds.has(room.id)) matchingIds.add(room.parent_id);
  }
  const visibleRooms = allRooms.filter((room) => matchingIds.has(room.id));
  const displayRooms = visibleRooms.filter((room) => !room.parent_id).flatMap((parent) => [parent, ...visibleRooms.filter((room) => room.parent_id === parent.id)]);
  displayRooms.forEach((room, index) => {
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
    if (!room.parent_id && !isGuideRoom(room)) {
      row.draggable = true;
      row.dataset.roomId = room.id;
      row.setAttribute('aria-label', `${room.name} 방 순서 변경 가능`);
      row.addEventListener('dragstart', (event) => {
        row.classList.add('dragging');
        event.dataTransfer?.setData('text/plain', room.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        ui.roomList.querySelectorAll('.room-row.drag-over').forEach((item) => item.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', (event) => {
        if (!event.dataTransfer) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        ui.roomList.querySelectorAll('.room-row.drag-over').forEach((item) => item.classList.remove('drag-over'));
        if (row.dataset.roomId !== event.dataTransfer.getData('text/plain')) row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', (event) => {
        if (!row.contains(event.relatedTarget)) row.classList.remove('drag-over');
      });
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        row.classList.remove('drag-over');
        const draggedId = event.dataTransfer?.getData('text/plain');
        const targetId = row.dataset.roomId;
        if (!draggedId || draggedId === targetId) return;
        const topLevel = sortedRooms().filter((item) => !item.parent_id && !isGuideRoom(item));
        const ids = topLevel.map((item) => item.id);
        const from = ids.indexOf(draggedId);
        const to = ids.indexOf(targetId);
        if (from < 0 || to < 0) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        try { localStorage.setItem(ROOM_ORDER_KEY, JSON.stringify(ids)); } catch {}
        renderRoomLists();
      });
    }
    const desktop = document.createElement('button');
    desktop.type = 'button';
    desktop.className = `room-item${state.room?.id === room.id ? ' active' : ''}${room.is_featured ? ' featured' : ''}${room.parent_id ? ' child-room' : ''}`;
    desktop.setAttribute('aria-current', state.room?.id === room.id ? 'page' : 'false');
    const number = document.createElement('span');
    number.className = `room-number${room.parent_id ? ' child-room-number' : ''}`;
    if (room.image_path) { number.classList.add('has-image'); paintAvatar(number, room.name, roomImageUrl(room)); }
    else number.textContent = room.parent_id ? '↳' : room.is_featured ? '★' : '#';
    const title = document.createElement('span');
    title.className = 'room-title';
    title.textContent = room.name;
    const arrow = document.createElement('span');
    arrow.className = 'room-arrow';
    arrow.textContent = '↗';
    desktop.append(number, title, arrow);
    desktop.addEventListener('click', () => switchRoom(room));
    row.append(desktop);
    if (!isGuideRoom(room)) {
      const favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = `room-favorite-button${roomFavorites.has(room.id) ? ' active' : ''}`;
      favorite.textContent = roomFavorites.has(room.id) ? '★' : '☆';
      favorite.title = roomFavorites.has(room.id) ? '즐겨찾기 해제' : '방 즐겨찾기';
      favorite.setAttribute('aria-label', `${room.name} ${favorite.title}`);
      favorite.setAttribute('aria-pressed', String(roomFavorites.has(room.id)));
      favorite.addEventListener('click', (event) => { event.stopPropagation(); toggleRoomFavorite(room); });
      row.append(favorite);
    }
    ui.roomList.append(row);

    const mobile = document.createElement('button');
    mobile.type = 'button';
    mobile.className = `mobile-room-chip${state.room?.id === room.id ? ' active' : ''}${room.is_featured ? ' featured' : ''}${room.parent_id ? ' child-room' : ''}`;
    if (room.image_path) {
      const icon = document.createElement('span');
      icon.className = 'chip-icon';
      paintAvatar(icon, room.name, roomImageUrl(room));
      mobile.append(icon, document.createTextNode(`${room.is_featured ? '★ ' : ''}${room.name}`));
    } else mobile.textContent = `${room.parent_id ? '↳ ' : room.is_featured ? '★ ' : ''}${room.name}`;
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
  ui.roomImageButton.textContent = room.image_path ? '채널 이미지 변경' : '채널 이미지 추가';
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
  if (error) return showToast(errorText(error, '채널 이미지를 삭제하지 못했어요.'));
  room.image_path = null;
  renderRoomImageControls(room);
  renderRoomLists();
  showToast('채널 이미지를 삭제했어요.');
}
function updateRoomHeading(room) {
  renderRoomImageControls(room);
  updateComposerAvailability();
  ui.roomName.textContent = room.name;
  ui.bannerName.textContent = room.name;
  const parentRoom = room.parent_id ? state.rooms.find((item) => item.id === room.parent_id) : null;
  const guideRoom = isGuideRoom(room);
  ui.roomTopic.textContent = guideRoom
    ? ''
    : parentRoom ? `하위 채널 · ${parentRoom.name}` : '공개 채널';
  ui.roomTopic.hidden = guideRoom;
  ui.childRoomButton.hidden = Boolean(room.parent_id || guideRoom);
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
function extractYouTubeVideoId(content) {
  if (typeof content !== 'string') return null;
  // Mobile share sheets and some apps omit the protocol or use the mobile host.
  const pattern = /(?:(?:https?:\/\/)?(?:www\.)?(?:(?:m|music)\.)?youtube(?:-nocookie)?\.com\/[^\s<>]+|(?:https?:\/\/)?(?:www\.)?youtu\.be\/[^\s<>]+)/giu;
  const candidates = content.match(pattern) || [];
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/[),.!?;]+$/u, '');
    let url;
    try { url = new URL(/^https?:\/\//iu.test(cleaned) ? cleaned : 'https://' + cleaned); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/^www\./u, '');
    let id = null;
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || null;
    else if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] || null;
    }
    if (id && /^[A-Za-z0-9_-]{11}$/u.test(id)) return id;
  }
  return null;
}
function stripYouTubeUrls(content) {
  return String(content || '')
    .replace(/(?:(?:https?:\/\/)?(?:www\.)?(?:(?:m|music)\.)?youtube(?:-nocookie)?\.com\/[^\s<>]+|(?:https?:\/\/)?(?:www\.)?youtu\.be\/[^\s<>]+)/giu, ' ')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .trim();
}
function createYouTubeEmbed(videoId) {
  const frame = document.createElement('iframe');
  frame.className = 'message-youtube-player';
  // Explicit inline playback improves the mobile experience, especially on iOS.
  frame.src = 'https://www.youtube-nocookie.com/embed/' + videoId + '?playsinline=1&rel=0';
  frame.title = 'YouTube 동영상 플레이어';
  frame.loading = 'lazy';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  frame.allowFullscreen = true;
  frame.setAttribute('playsinline', '');
  frame.setAttribute('webkit-playsinline', '');
  return frame;
}

function linkifyTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest('a,button,script,style')) continue;
    if (/https?:\/\//iu.test(node.nodeValue || '')) nodes.push(node);
  }
  const urlPattern = /https?:\/\/[^\s<>"']+/giu;
  for (const node of nodes) {
    const value = node.nodeValue || '';
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of value.matchAll(urlPattern)) {
      let raw = match[0];
      let url = raw;
      while (/[.,!?;:)\]}]$/u.test(url)) url = url.slice(0, -1);
      if (!url) continue;
      if (match.index > last) fragment.append(document.createTextNode(value.slice(last, match.index)));
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
        const link = document.createElement('a');
        link.href = parsed.href;
        link.target = window.matchMedia('(pointer: coarse)').matches ? '_self' : '_blank';
        link.rel = 'noopener noreferrer nofollow';
        link.className = 'chat-hyperlink';
        link.textContent = url;
        fragment.append(link);
        if (raw.length > url.length) fragment.append(document.createTextNode(raw.slice(url.length)));
        last = match.index + raw.length;
      } catch {
        fragment.append(document.createTextNode(raw));
        last = match.index + raw.length;
      }
    }
    if (last < value.length) fragment.append(document.createTextNode(value.slice(last)));
    node.replaceWith(fragment);
  }
}
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
async function refreshMessageReactions(messageIds = state.messages.map((message) => message.id)) {
  const ids = [...new Set(messageIds.map((id) => String(id)))];
  if (!ids.length) { state.messageReactions = new Map(); return; }
  const { data, error } = await supabase.from('roomchat_message_reactions')
    .select('message_id,user_id,emoji').in('message_id', ids);
  if (error) {
    // Reactions are optional; a missing table or policy must not break chat history.
    console.warn('Message reactions are unavailable.');
    return;
  }
  const grouped = new Map();
  for (const reaction of data || []) {
    const key = String(reaction.message_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(reaction);
  }
  state.messageReactions = grouped;
}
async function toggleMessageReaction(message, emoji, button) {
  if (!state.user) return showToast('이모지 반응을 사용하려면 계정에 로그인해 주세요.');
  button.disabled = true;
  const existing = (state.messageReactions.get(String(message.id)) || [])
    .some((reaction) => reaction.user_id === state.user.id && reaction.emoji === emoji);
  try {
    const request = existing
      ? supabase.from('roomchat_message_reactions').delete().eq('message_id', message.id).eq('user_id', state.user.id).eq('emoji', emoji)
      : supabase.from('roomchat_message_reactions').insert({ message_id: message.id, user_id: state.user.id, emoji });
    const { error } = await request;
    if (error) throw error;
    await refreshMessageReactions();
    const row = ui.messages.querySelector(`[data-message-id="${CSS.escape(String(message.id))}"]`);
    if (row) {
      const oldBar = row.querySelector('.message-reactions');
      oldBar?.remove();
      const bar = createReactionBar(message);
      const body = row.querySelector('.message-body');
      body?.append(bar);
    }
  } catch (error) {
    showToast(errorText(error, '반응을 저장하지 못했어요. 로그인 상태를 확인해 주세요.'));
  } finally {
    button.disabled = false;
  }
}
function createReactionBar(message) {
  const bar = document.createElement('div');
  bar.className = 'message-reactions';
  bar.setAttribute('aria-label', '메시지 이모지 반응');
  const reactions = state.messageReactions.get(String(message.id)) || [];
  for (const emoji of REACTION_EMOJIS) {
    const matching = reactions.filter((reaction) => reaction.emoji === emoji);
    const mine = Boolean(state.user && matching.some((reaction) => reaction.user_id === state.user.id));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `message-reaction${mine ? ' selected' : ''}`;
    button.textContent = matching.length ? `${emoji} ${matching.length}` : emoji;
    button.title = state.user ? (mine ? '내 반응 취소' : '반응 추가') : '반응하려면 로그인하세요';
    button.setAttribute('aria-pressed', String(mine));
    button.addEventListener('click', () => toggleMessageReaction(message, emoji, button));
    bar.append(button);
  }
  return bar;
}
async function loadPinnedMessages(roomId) {
  const { data, error } = await supabase.from('roomchat_message_pins').select('message_id').eq('room_id', roomId);
  if (error) {
    console.warn('Could not load pinned messages');
    state.pinnedMessageIds = new Set();
    return;
  }
  state.pinnedMessageIds = new Set((data || []).map((item) => String(item.message_id)));
}
async function toggleMessagePin(message) {
  if (!state.isAdmin) return showToast('관리자만 메시지를 고정할 수 있어요.');
  const currentlyPinned = state.pinnedMessageIds.has(String(message.id));
  const { error } = await supabase.rpc('roomchat_admin_set_message_pin', {
    p_room_id: message.room_id || state.room?.id,
    p_message_id: message.id,
    p_pin: !currentlyPinned,
  });
  if (error) return showToast(errorText(error, '메시지 고정 상태를 바꾸지 못했어요.'));
  if (currentlyPinned) state.pinnedMessageIds.delete(String(message.id));
  else state.pinnedMessageIds.add(String(message.id));
  renderMessages();
  showToast(currentlyPinned ? '메시지 고정을 해제했어요.' : '메시지를 고정했어요.');
}
function setReplyTarget(message) {
  if (!message || !state.room || message.room_id !== state.room.id) return;
  state.replyTarget = message;
  ui.replyPreviewName.textContent = displayNickname(message.nickname || '익명', Boolean(message.is_verified));
  ui.replyPreviewContent.textContent = (message.content || (message.image_path ? '사진' : '메시지')).replace(/\s+/gu, ' ').slice(0, 180);
  ui.replyPreview.hidden = false;
  ui.messageInput.focus();
}
function clearReplyTarget() {
  state.replyTarget = null;
  if (ui.replyPreview) ui.replyPreview.hidden = true;
  if (ui.replyPreviewName) ui.replyPreviewName.textContent = '';
  if (ui.replyPreviewContent) ui.replyPreviewContent.textContent = '';
}
function createReplyQuote(message) {
  if (!message.reply_to) return null;
  const original = state.messages.find((item) => String(item.id) === String(message.reply_to));
  const quote = document.createElement('button');
  quote.type = 'button';
  quote.className = 'message-reply-quote';
  quote.setAttribute('aria-label', '답글 원본 메시지로 이동');
  const heading = document.createElement('strong');
  heading.textContent = original ? displayNickname(original.nickname || '익명', Boolean(original.is_verified)) : '원본 메시지';
  const excerpt = document.createElement('span');
  excerpt.textContent = original
    ? (original.content || (original.image_path ? '사진' : '메시지')).replace(/\s+/gu, ' ').slice(0, 180)
    : '원본 메시지가 최근 기록에 없어요.';
  quote.append(heading, excerpt);
  if (original) quote.addEventListener('click', () => {
    const target = ui.messages.querySelector(`[data-message-id="${CSS.escape(String(original.id))}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('message-link-target');
      window.setTimeout(() => target.classList.remove('message-link-target'), 1800);
    } else showToast('원본 메시지가 현재 화면에 없어요.');
  });
  else quote.disabled = true;
  return quote;
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
  if (state.newMessageDividerId && String(state.newMessageDividerId) === key) {
    const divider = document.createElement('div'); divider.className = 'new-message-divider'; divider.textContent = '새 메시지'; divider.setAttribute('role', 'separator');
    ui.messages.append(divider);
  }
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
  if (message.edited_at) {
    const edited = document.createElement('span');
    edited.className = 'message-edited';
    edited.textContent = '수정됨';
    edited.title = `수정 시간: ${formatTime(message.edited_at)}`;
    meta.append(edited);
  }
  if (state.pinnedMessageIds?.has(String(message.id))) {
    const pinned = document.createElement('span');
    pinned.className = 'message-pinned-label';
    pinned.textContent = '📌 고정됨';
    pinned.setAttribute('aria-label', '고정된 메시지');
    meta.append(pinned);
  }
  body.append(meta);
  const replyQuote = createReplyQuote(message);
  if (replyQuote) body.append(replyQuote);
  const gifMatch = typeof message.content === 'string' ? message.content.match(GIF_URL_PATTERN) : null;
  const youtubeVideoId = !gifMatch ? extractYouTubeVideoId(message.content) : null;
  const showYoutubePreview = Boolean(youtubeVideoId && state.youtubePreviewEnabled !== false);
  if (showYoutubePreview) {
    const videoCard = document.createElement('div');
    videoCard.className = 'message-youtube';
    videoCard.append(createYouTubeEmbed(youtubeVideoId));
    body.append(videoCard);
  }
  if (gifMatch) {
    const gifLink = document.createElement('a');
    gifLink.className = 'message-image-link message-gif-link';
    gifLink.href = gifMatch[1];
    gifLink.target = '_blank';
    gifLink.rel = 'noopener noreferrer';
    gifLink.setAttribute('aria-label', 'GIF 크게 보기');
    gifLink.addEventListener('click', (event) => { event.preventDefault(); openImageZoom(gifMatch[1], '채팅방에서 공유한 GIF'); });
    const gif = document.createElement('img');
    gif.className = 'message-image message-gif';
    gif.src = gifMatch[1];
    gif.alt = 'GIPHY에서 보낸 GIF';
    gif.loading = 'lazy';
    gifLink.append(gif);
    body.append(gifLink);
  } else {
    // Keep any caption the sender wrote next to a video. If previews are disabled,
    // retain the original URL text so the message never disappears from the thread.
    const displayContent = showYoutubePreview ? stripYouTubeUrls(message.content) : String(message.content || '');
    if (displayContent) {
      const text = document.createElement('p');
      text.className = 'message-content';
      if (message.user_id) { text.dataset.styleUser = message.user_id; text.dataset.styleKind = 'text'; }
      text.append(renderMentions(displayContent, getMentionNames(), state.nickname));
      linkifyTextNodes(text);
      body.append(text);
    }
  }
  if (message.image_path) {
    const { data } = supabase.storage.from('chat-images').getPublicUrl(message.image_path);
    const imageLink = document.createElement('a');
    imageLink.className = 'message-image-link';
    imageLink.href = data.publicUrl;
    imageLink.target = '_blank';
    imageLink.rel = 'noopener noreferrer';
    imageLink.setAttribute('aria-label', '공유 이미지 크게 보기');
    imageLink.addEventListener('click', (event) => { event.preventDefault(); openImageZoom(data.publicUrl, '채팅방에서 공유한 이미지'); });
    const image = document.createElement('img');
    image.className = 'message-image';
    image.src = data.publicUrl;
    image.alt = '채팅방에서 공유한 이미지';
    image.loading = 'lazy';
    imageLink.append(image);
    body.append(imageLink);
  }
  body.append(createReactionBar(message));
  row.append(body);
  const reply = document.createElement('button');
  reply.type = 'button';
  reply.className = 'admin-action message-reply';
  reply.textContent = '답글';
  reply.setAttribute('aria-label', '이 메시지에 답글 쓰기');
  reply.addEventListener('click', () => setReplyTarget(message));
  row.append(reply);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'admin-action message-copy';
  copy.textContent = '복사';
  copy.setAttribute('aria-label', '메시지 내용 복사');
  copy.addEventListener('click', async () => {
    const copyText = [message.content || '', message.image_path ? '[사진]' : ''].filter(Boolean).join('\n');
    if (!copyText) return showToast('복사할 텍스트가 없어요.');
    try {
      await navigator.clipboard.writeText(copyText);
      showToast('메시지를 복사했어요.');
    } catch {
      const fallback = document.createElement('textarea');
      fallback.value = copyText;
      fallback.setAttribute('readonly', '');
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      document.body.append(fallback);
      fallback.select();
      const copied = document.execCommand('copy');
      fallback.remove();
      showToast(copied ? '메시지를 복사했어요.' : '복사하지 못했어요. 브라우저 권한을 확인해 주세요.');
    }
  });
  row.append(copy);
  const permalink = document.createElement('button');
  permalink.type = 'button';
  permalink.className = 'admin-action message-link';
  permalink.textContent = '링크';
  permalink.setAttribute('aria-label', '메시지 링크 복사');
  permalink.addEventListener('click', async () => {
    const link = `${window.location.origin}${window.location.pathname}#room=${encodeURIComponent(message.room_id || state.room?.id || '')}&message=${encodeURIComponent(message.id)}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast('메시지 링크를 복사했어요.');
    } catch {
      showToast('링크를 복사하지 못했어요. 브라우저 권한을 확인해 주세요.');
    }
  });
  row.append(permalink);
  if (state.isAdmin) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'admin-action message-pin';
    const pinned = state.pinnedMessageIds?.has(String(message.id));
    pin.textContent = pinned ? '고정 해제' : '고정';
    pin.setAttribute('aria-label', pinned ? '메시지 고정 해제' : '메시지 고정');
    pin.addEventListener('click', () => toggleMessagePin(message));
    row.append(pin);
  }
  if (isOwn && message.content && !message.image_path) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'admin-action message-edit';
    edit.textContent = '수정';
    edit.setAttribute('aria-label', '내 메시지 수정');
    edit.addEventListener('click', () => editMessage(message));
    row.append(edit);
  }
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
  title.textContent = 'RoomChat에 오신 것을 환영해요';
  const lead = document.createElement('p');
  lead.className = 'guide-lead';
  lead.textContent = '닉네임만 정하면 바로 대화에 참여할 수 있어요. 이 안내에서 RoomChat의 주요 기능과 이용 방법을 확인해 보세요.';
  const list = document.createElement('ul');
  list.className = 'guide-list';
  for (const [head, text] of [
    ['간편한 시작', '게스트로 바로 참여하거나 닉네임과 비밀번호로 계정을 만들 수 있어요. 계정을 만들면 닉네임을 안전하게 이어서 사용할 수 있어요.'],
    ['닉네임', '사용할 수 없거나 이미 사용 중인 닉네임은 다른 이름으로 자동 조정될 수 있어요.'],
    ['관리자 인증', '인증 배지는 공식 관리자 계정에만 표시돼요. 다른 사용자는 직접 설정할 수 없어요.'],
    ['채널 만들기', '누구나 공개 채널을 만들 수 있어요. 채널을 만든 사람은 해당 채널의 운영 권한을 갖게 돼요.'],
    ['안전한 대화', '운영진은 이용 규칙을 지키고 쾌적한 대화 환경을 유지할 수 있도록 관리해요.'],
    ['미디어와 알림', 'GIF와 사진을 공유하고, 프로필을 꾸며 보세요. 알림을 켜면 새 메시지도 놓치지 않을 수 있어요.'],
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
      empty.innerHTML = '<span class="empty-symbol">✳</span><strong>아직 대화가 시작되지 않았어요.</strong><span>먼저 인사를 건네 보세요.</span>';
      ui.messages.append(empty);
    }
    return;
  }
  const query = (state.messageSearchQuery || '').trim().toLocaleLowerCase();
  const dateFilter = state.messageSearchDate || '';
  const filteredMessages = state.messages.filter((message) => {
    if (mediaOnlyMode && !message.image_path && !GIF_URL_PATTERN.test(String(message.content || ''))) return false;
    const matchesText = !query || [message.content, message.nickname].some((value) => String(value || '').toLocaleLowerCase().includes(query));
    const created = new Date(message.created_at);
    const localDate = Number.isNaN(created.getTime()) ? '' : `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;
    return matchesText && (!dateFilter || localDate === dateFilter);
  });
  filteredMessages.forEach(renderMessage);
  if ((query || dateFilter) && filteredMessages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state search-empty-state';
    const title = document.createElement('strong');
    title.textContent = '검색 결과가 없어요.';
    const hint = document.createElement('span');
    hint.textContent = '검색어 또는 날짜를 바꾸거나 초기화해 보세요.';
    empty.append(title, hint);
    ui.messages.append(empty);
  }
  if (!query && !dateFilter) ui.messages.scrollTop = guide ? 0 : ui.messages.scrollHeight;
  const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  const targetMessageId = hashParams.get('message');
  const targetRoomId = hashParams.get('room');
  if (targetMessageId && (!targetRoomId || targetRoomId === state.room?.id)) {
    const target = ui.messages.querySelector(`[data-message-id="${CSS.escape(targetMessageId)}"]`);
    if (target) {
      target.classList.add('message-link-target');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => target.classList.remove('message-link-target'), 2200);
    }
  }
  loadAvatars(filteredMessages.map((message) => message.user_id));
}
function addMessage(message) {
  if (state.messages.some((item) => String(item.id) === String(message.id))) return;
  const nearBottom = ui.messages.scrollHeight - ui.messages.scrollTop - ui.messages.clientHeight < 80;
  const incoming = !isOwnMessage(message);
  if (incoming && !nearBottom && !state.messageSearchQuery && !state.messageSearchDate) {
    state.unreadRoomMessages += 1;
    if (!state.newMessageDividerId) state.newMessageDividerId = String(message.id);
    updateUnreadRoomMessages();
  }
  loadAvatars([message.user_id]);
  state.messages.push(message);
  state.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (!state.room?.unlimited_messages) {
    while (state.messages.length > 30) {
      const oldest = state.messages.shift();
      const oldNode = ui.messages.querySelector(`[data-message-id="${CSS.escape(String(oldest.id))}"]`);
      oldNode?.remove();
    }
  }
  renderMessage(message);
  if (nearBottom || isOwnMessage(message)) { ui.messages.scrollTop = ui.messages.scrollHeight; clearUnreadRoomMessages(); }
  if (ui.adminPanelDialog.open) renderAdminPanel();
}
function normalizeRpcRow(data) { return Array.isArray(data) ? data[0] : data; }
async function loadRooms() {
  const fetchRooms = (columns) => supabase.from('rooms').select(columns)
    .order('is_featured', { ascending: false }).order('created_at', { ascending: true }).limit(100);
  let { data, error } = await fetchRooms('id,name,created_at,created_by,is_featured,image_path,parent_id,unlimited_messages');
  // 방 이미지 열이 없는 이전 DB에서도 목록을 표시합니다. 하위 방 열은 필수입니다.
  if (error) ({ data, error } = await fetchRooms('id,name,created_at,created_by,is_featured,parent_id,unlimited_messages'));
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
    ? '이 채널의 운영 권한이 있어요. 필요한 경우 참여자를 내보낼 수 있어요.'
    : '채널 운영자는 해당 채널의 참여자를 관리할 수 있어요.';
  if (!members.length) {
    const empty = document.createElement('div');
    empty.className = 'member-empty';
    empty.textContent = '현재 접속 중인 사용자가 없어요.';
    ui.memberList.append(empty);
    const sidebarEmpty = document.createElement('p');
    sidebarEmpty.className = 'sidebar-member-empty';
    sidebarEmpty.textContent = '현재 접속자가 없어요.';
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
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (request !== state.roomRequest || payload?.sender === (state.user?.id || `guest:${guestSessionId}`)) return;
      showRemoteTyping(payload?.nickname || '누군가');
    })
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

const ROUTE_RESERVED = new Set(['messages','log-in','profile','friends','settings','new-room','help','404.html']);
function roomSlug(name) {
  return String(name || '').normalize('NFC').trim().toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/gu, '') || 'room';
}
function routeBase() {
  return '/roomchat/';
}
function routePathForRoom(room) {
  return routeBase() + roomSlug(room?.name || 'room');
}
function navigatePath(path, replace = false) {
  const target = path.startsWith('/') ? path : routeBase() + path;
  if (window.location.pathname === target) return;
  window.history[replace ? 'replaceState' : 'pushState']({ roomchatRoute: true }, '', target);
}
function routeKind() {
  const base = routeBase();
  let path = window.location.pathname;
  if (path.startsWith(base)) path = path.slice(base.length);
  else path = path.replace(/^\/+/, '');
  try { path = decodeURIComponent(path); } catch {}
  path = path.replace(/\/+$/, '');
  if (!path || path === 'index.html' || path === 'messages') return { type: 'messages' };
  if (path === 'log-in' || path === 'login') return { type: 'login' };
  if (path === 'profile') return { type: 'profile' };
  if (path === 'friends') return { type: 'friends' };
  if (path === 'settings') return { type: 'settings' };
  if (ROUTE_RESERVED.has(path)) return { type: 'messages' };
  return { type: 'room', slug: roomSlug(path) };
}
function findRoomForRoute(route) {
  if (route.type !== 'room') return null;
  return state.rooms.find((room) => roomSlug(room.name) === route.slug) || null;
}

async function switchRoom(room) {
  if (!room || (state.room?.id === room.id && state.roomChannel)) return;
  if (!window.__roomchatRouting) navigatePath(routePathForRoom(room));
  clearReplyTarget();
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
  state.unreadRoomMessages = 0; state.newMessageDividerId = null; updateUnreadRoomMessages();
  typingIndicator.hidden = true; remoteTypingName = ''; window.clearTimeout(state.typingClearTimer);
  showLoading();
  renderMembers();
  let data = [];
  let error = null;
  if (room.unlimited_messages) {
    // Supabase returns a limited number of rows per request, so fetch history in pages.
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const page = await supabase.from('messages')
        .select('id,room_id,nickname,content,image_path,created_at,user_id,guest_session_id,is_verified,edited_at,reply_to')
        .eq('room_id', room.id).order('created_at', { ascending: true }).range(offset, offset + pageSize - 1);
      if (page.error) { error = page.error; break; }
      data.push(...(page.data || []));
      if (!page.data || page.data.length < pageSize) break;
    }
  } else {
    const result = await supabase.from('messages')
      .select('id,room_id,nickname,content,image_path,created_at,user_id,guest_session_id,is_verified,edited_at,reply_to')
      .eq('room_id', room.id).order('created_at', { ascending: true }).limit(30);
    data = result.data || [];
    error = result.error;
  }
  if (request !== state.roomRequest) return;
  if (error) {
    ui.messages.replaceChildren();
    showToast('대화 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    console.error('message history request failed');
    return;
  }
  state.messages = data || [];
  state.messageReactions = new Map();
  await loadPinnedMessages(room.id);
  if (request !== state.roomRequest) return;
  await refreshMessageReactions(state.messages.map((message) => message.id));
  if (request !== state.roomRequest) return;
  renderMessages();
  if (state.nickname) await subscribeCurrentRoom(request);
  if (ui.adminPanelDialog.open) renderAdminPanel();
}
async function createRoom(name, parentRoomId = null, unlimitedMessages = false) {
  const cleanName = [...name.trim().replace(/\s+/gu, ' ')].slice(0, 20).join('');
  if (cleanName.length < 2 || cleanName.length > 32) return showToast('방 이름은 2~32자로 입력해 주세요.');
  const ownerToken = state.user ? null : `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const { data, error } = await supabase.rpc('roomchat_create_room', {
    p_name: cleanName,
    p_guest_session_id: state.user ? null : guestSessionId,
    p_guest_token: state.user ? null : guestToken,
    p_owner_token: ownerToken,
    p_parent_room_id: parentRoomId,
    p_unlimited_messages: state.isAdmin && !parentRoomId && unlimitedMessages,
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
  ui.accountTitle.textContent = mode === 'register' ? '계정 만들기' : '로그인';
  ui.accountDescription.textContent = mode === 'register'
    ? '닉네임과 비밀번호로 간편하게 계정을 만들 수 있어요. 이메일은 필요하지 않아요.'
    : '등록한 닉네임과 비밀번호로 로그인하세요.';
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
  ui.nicknameTitle.innerHTML = state.user ? '닉네임을<br />변경할까요?' : '어떤 닉네임으로<br />참여할까요?';
  ui.nicknameDescription.textContent = state.user
    ? '계정 닉네임은 저장되어 다음에도 사용할 수 있어요. 닉네임을 변경해도 관리자 인증은 유지돼요.'
    : '게스트 닉네임은 현재 탭에서만 사용돼요. 계정을 만들면 닉네임과 프로필을 저장해 계속 사용할 수 있어요.';
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
async function openRoomDialog(parentRoomId = null) {
  if (!state.nickname) { showNicknameDialog(); return; }
  const parentRoom = parentRoomId ? state.rooms.find((room) => room.id === parentRoomId && !room.parent_id) : null;
  if (parentRoomId && !parentRoom) return showToast('하위 방은 상위 채널에서만 만들 수 있어요.');
  state.pendingParentRoomId = parentRoom?.id || null;
  const unlimitedWrap = $('#room-unlimited-choice-wrap');
  if (unlimitedWrap) unlimitedWrap.hidden = !state.isAdmin || Boolean(parentRoom);
  if (ui.roomUnlimitedChoice) ui.roomUnlimitedChoice.checked = false;
  ui.roomInput.value = '';
  ui.roomDialog.querySelector('h2').textContent = parentRoom ? '하위 채널 만들기' : '새 채널 만들기';
  ui.roomDialog.querySelector('p').textContent = parentRoom
    ? `“${parentRoom.name}” 안에 하위 채널을 만들어요. 하위 채널 안에는 또 다른 채널을 만들 수 없어요.`
    : '누구나 공개 채널을 만들 수 있어요. 채널을 만든 사람은 해당 채널의 운영자가 됩니다.';
  ui.roomDialog.querySelector('label[for="room-input"]').textContent = parentRoom ? '하위 채널 이름' : '채널 이름';
  ui.roomDialog.showModal();
  ui.roomInput.focus();
}
function closeMentionPopup() {
  if (!ui.mentionPopup) return;
  ui.mentionPopup.hidden = true;
  ui.mentionPopup.replaceChildren();
  mentionItems = [];
  mentionToken = null;
}
function updateMentionSuggestions() {
  if (!ui.mentionPopup || !state.room || isGuideRoom(state.room)) return closeMentionPopup();
  const value = ui.messageInput.value;
  const caret = ui.messageInput.selectionStart ?? value.length;
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/u);
  if (!match) return closeMentionPopup();
  const query = match[1].toLocaleLowerCase();
  const start = caret - match[0].length + match[0].lastIndexOf('@');
  const names = [...new Set(['everyone', ...getMentionNames().filter(Boolean)])]
    .filter((name) => name.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      if (a === 'everyone') return -1;
      if (b === 'everyone') return 1;
      const aStarts = a.toLocaleLowerCase().startsWith(query);
      const bStarts = b.toLocaleLowerCase().startsWith(query);
      return Number(bStarts) - Number(aStarts) || a.localeCompare(b, 'ko');
    }).slice(0, 8);
  if (!names.length) return closeMentionPopup();
  mentionItems = names;
  mentionActiveIndex = Math.min(mentionActiveIndex, names.length - 1);
  mentionToken = { start, end: caret };
  renderMentionPopup();
}
function renderMentionPopup() {
  ui.mentionPopup.replaceChildren();
  const hint = document.createElement('div');
  hint.className = 'mention-popup-hint';
  hint.textContent = '사람 또는 전체 멘션';
  ui.mentionPopup.append(hint);
  mentionItems.forEach((name, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `mention-option${name === 'everyone' ? ' mention-everyone-option' : ''}${index === mentionActiveIndex ? ' active' : ''}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(index === mentionActiveIndex));
    option.textContent = name === 'everyone' ? '@everyone · 이 채널의 모든 사람' : `@${name}`;
    option.addEventListener('click', () => chooseMention(name));
    ui.mentionPopup.append(option);
  });
  ui.mentionPopup.hidden = false;
}
function chooseMention(name) {
  if (!mentionToken || !name) return closeMentionPopup();
  const value = ui.messageInput.value;
  const insertion = `@${name} `;
  ui.messageInput.value = value.slice(0, mentionToken.start) + insertion + value.slice(mentionToken.end);
  const caret = mentionToken.start + insertion.length;
  ui.messageInput.focus();
  ui.messageInput.setSelectionRange(caret, caret);
  ui.charCount.textContent = `${ui.messageInput.value.length} / 2000`;
  ui.messageInput.style.height = 'auto';
  ui.messageInput.style.height = `${Math.min(ui.messageInput.scrollHeight, 150)}px`;
  closeMentionPopup();
}
async function sendMessage(event) {
  event?.preventDefault();
  if (isGuideRoom(state.room)) return showToast('안내 채널에서는 메시지를 보낼 수 없어요.');
  if (!state.nickname) { showNicknameDialog(); return; }
  if (!state.room) return showToast('먼저 채널을 선택해 주세요.');
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
    const postArgs = {
      p_room_id: state.room.id,
      p_content: content || null,
      p_image_path: imagePath,
      p_guest_session_id: state.user ? null : guestSessionId,
      p_guest_token: state.user ? null : guestToken,
    };
    const { data, error } = await supabase.rpc(
      state.replyTarget ? 'roomchat_post_reply' : 'roomchat_post_message',
      state.replyTarget ? { ...postArgs, p_reply_to: state.replyTarget.id } : postArgs,
    );
    if (error) throw error;
    const inserted = normalizeRpcRow(data);
    if (inserted) addMessage(inserted);
    ui.messageInput.value = '';
    clearReplyTarget();
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
  if (state.soundEnabled === false) return;
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
function readNotificationHistory() {
  try {
    const value = JSON.parse(localStorage.getItem('roomchat:notification-history') || '[]');
    return Array.isArray(value) ? value.slice(0, 50) : [];
  } catch { return []; }
}
function renderNotificationHistory() {
  if (!ui.notificationHistoryList) return;
  ui.notificationHistoryList.replaceChildren();
  const history = state.notificationHistory || [];
  if (!history.length) {
    const empty = document.createElement('li');
    empty.className = 'notification-history-empty';
    empty.textContent = '아직 알림 기록이 없어요.';
    ui.notificationHistoryList.append(empty);
    return;
  }
  history.forEach((item) => {
    const row = document.createElement('li');
    row.className = 'notification-history-item';
    const title = document.createElement('strong');
    title.textContent = item.title || '알림';
    const body = document.createElement('span');
    body.textContent = item.body || '';
    const time = document.createElement('time');
    time.textContent = item.at ? new Date(item.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    row.append(title, body, time);
    ui.notificationHistoryList.append(row);
  });
}
function recordNotificationHistory(title, body) {
  const entry = { title: String(title || '').slice(0, 160), body: String(body || '').slice(0, 300), at: new Date().toISOString() };
  state.notificationHistory = [entry, ...readNotificationHistory()].slice(0, 50);
  try { localStorage.setItem('roomchat:notification-history', JSON.stringify(state.notificationHistory)); } catch {}
  renderNotificationHistory();
}
function notifyUser(title, body, tag) {
  if (!state.notifications) return;
  recordNotificationHistory(title, body);
  playMessageSound();
  showSystemNotification(title, body, tag);
}
async function notifyIncoming(message) {
  const mentioned = mentionsName(message.content, state.nickname);
  const author = displayNickname(message.nickname || '익명', Boolean(message.is_verified));
  const title = mentioned ? `${author}님이 회원님을 언급했어요 · ${state.room?.name || 'roomchat'}` : `${author} · ${state.room?.name || 'roomchat'}`;
  const body = GIF_URL_PATTERN.test(message.content || '') ? 'GIF를 보냈어요.' : (message.content || '사진을 공유했어요.');
  recordNotificationHistory(title, body);
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
async function editMessage(message) {
  if (!isOwnMessage(message) || !message?.id) return;
  const nextContent = window.prompt('메시지를 수정해 주세요. (최대 2000자)', message.content || '');
  if (nextContent === null) return;
  const content = nextContent.trim();
  if (!content) return showToast('메시지 내용을 입력해 주세요.');
  if (content.length > 2000) return showToast('메시지는 2000자 이내로 입력해 주세요.');
  if (content === message.content) return;
  try {
    const { data, error } = await supabase.rpc('roomchat_edit_my_message', {
      p_message_id: message.id,
      p_content: content,
      p_guest_session_id: state.user ? null : guestSessionId,
      p_guest_token: state.user ? null : guestToken,
    });
    if (error) throw error;
    const updated = normalizeRpcRow(data);
    if (updated) {
      state.messages = state.messages.map((item) => String(item.id) === String(updated.id) ? updated : item);
      renderMessages();
    }
    showToast('메시지를 수정했어요.');
  } catch (error) {
    showToast(errorText(error, '메시지를 수정하지 못했어요.'));
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
  if (!window.confirm(`“${room.name}” 채널과 메시지 기록을 삭제할까요?`)) return;
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
    showToast('채널과 메시지 기록을 삭제했어요.');
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
    if (url.protocol !== 'https:' || !/(^|\.)giphy\.com$/u.test(url.hostname)) return null;
    if (!/^\/media\/[A-Za-z0-9_\-/.]+\.(gif|webp)$/iu.test(url.pathname)) return null;
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
  const params = new URLSearchParams({ api_key: GIPHY_API_KEY, limit: '24', rating: 'g', lang: 'en', bundle: 'messaging_non_clips' });
  if (query) params.set('q', query);
  try {
    const response = await fetch(`https://api.giphy.com/v1/gifs/${query ? 'search' : 'trending'}?${params}`);
    if (!response.ok) {
      const detail = response.status === 401 || response.status === 403 ? 'GIPHY API 키가 거부됐어요. 키와 API 앱 상태를 확인해 주세요.'
        : response.status === 429 ? 'GIF 검색 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.'
        : `GIPHY 검색 오류 (HTTP ${response.status})`;
      throw new Error(detail);
    }
    const result = await response.json();
    if (request !== state.gifRequest) return;
    const items = (result.data || []).map((item) => ({
      title: String(item.title || 'GIF').slice(0, 80),
      preview: cleanGiphyUrl(item.images?.fixed_width_small?.url || item.images?.fixed_width?.url),
      send: cleanGiphyUrl(item.images?.downsized_medium?.url || item.images?.fixed_height?.url || item.images?.original?.url),
    })).filter((item) => item.preview && item.send);
    ui.gifStatus.textContent = items.length ? (query ? `“${query}” 검색 결과` : '인기 GIF') : ((result.data || []).length ? 'GIF는 검색됐지만 지원되는 미리보기 파일이 없어요. 다른 검색어로 시도해 주세요.' : '검색 결과가 없어요. 영어 검색어도 시도해 보세요.');
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
    if (request === state.gifRequest) ui.gifStatus.textContent = error instanceof Error && error.message !== 'Failed to fetch' ? error.message : 'GIF 서버에 연결하지 못했어요. 네트워크나 브라우저 확장 프로그램을 확인해 주세요.';
  }
}
function openGifDialog() {
  if (!state.nickname) { showNicknameDialog(); return; }
  if (!state.room) return showToast('먼저 채널을 선택해 주세요.');
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
    const postArgs = {
      p_room_id: state.room.id,
      p_content: `${GIF_PREFIX}${clean}`,
      p_image_path: null,
      p_guest_session_id: state.user ? null : guestSessionId,
      p_guest_token: state.user ? null : guestToken,
    };
    const { data, error } = await supabase.rpc(
      state.replyTarget ? 'roomchat_post_reply' : 'roomchat_post_message',
      state.replyTarget ? { ...postArgs, p_reply_to: state.replyTarget.id } : postArgs,
    );
    if (error) throw error;
    const inserted = normalizeRpcRow(data);
    if (inserted) addMessage(inserted);
    clearReplyTarget();
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
  ui.nicknameButton.addEventListener('click', () => { navigatePath(routeBase() + 'profile'); if (state.user) social?.openProfile(state.user.id); else showNicknameDialog(); });
  $('#sidebar-account-settings')?.addEventListener('click', () => { navigatePath(routeBase() + 'settings'); ui.nicknameButton.click(); });
  $('#nickname-close')?.addEventListener('click', () => ui.nicknameDialog.close());
  ui.accountOpen.addEventListener('click', () => { navigatePath(routeBase() + 'log-in'); ui.nicknameDialog.close(); showAccountDialog(); });
  ui.styleOpen.addEventListener('click', () => { ui.nicknameDialog.close(); social?.openStyleDialog(); });
  ui.signOut.addEventListener('click', async () => {
    await supabase.auth.signOut();
    await applySession(null);
    ui.nicknameDialog.close();
    showToast('로그아웃했어요. 이번 탭에서 게스트로 계속 이용할 수 있어요.');
    showNicknameDialog();
  });
  $('#new-room-button').addEventListener('click', () => openRoomDialog());
  ui.childRoomButton.addEventListener('click', () => { if (state.room && !state.room.parent_id) openRoomDialog(state.room.id); });
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
    const parentRoomId = state.pendingParentRoomId;
    const unlimitedMessages = Boolean(ui.roomUnlimitedChoice?.checked);
    state.pendingParentRoomId = null;
    ui.roomDialog.close();
    createRoom(value, parentRoomId, unlimitedMessages);
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
  state.notificationHistory = readNotificationHistory();
  renderNotificationHistory();
  const settingKey = 'roomchat:chat-settings:v1';
  try { localStorage.removeItem(settingKey); } catch {}
  const applyChatSettings = (settings = {}) => {
    document.documentElement.classList.remove('roomchat-dark');
    document.documentElement.classList.toggle('roomchat-wide', Boolean(settings.wide));
    document.documentElement.classList.toggle('roomchat-hide-members', Boolean(settings.hideSidebar));
    document.documentElement.classList.toggle('roomchat-sidebar-collapsed', Boolean(settings.sidebarCollapsed));
    state.youtubePreviewEnabled = settings.youtubePreview !== false;
    if (ui.settingYouTubePreview) ui.settingYouTubePreview.checked = state.youtubePreviewEnabled;
    if (ui.sidebarCollapseButton) {
      ui.sidebarCollapseButton.setAttribute('aria-pressed', String(Boolean(settings.sidebarCollapsed)));
      ui.sidebarCollapseButton.textContent = settings.sidebarCollapsed ? '⇥' : '⇤';
      ui.sidebarCollapseButton.setAttribute('aria-label', settings.sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기');
      ui.sidebarCollapseButton.title = settings.sidebarCollapsed ? '채팅방 목록 펼치기' : '채팅방 목록 접기';
    }
    document.documentElement.style.setProperty('--roomchat-message-font-size', `${[14,16,18,20].includes(Number(settings.fontSize)) ? Number(settings.fontSize) : 16}px`);
    state.soundEnabled = settings.sound !== false;
    if (ui.settingDark) { ui.settingDark.checked = false; ui.settingDark.disabled = true; }
    if (ui.settingWide) ui.settingWide.checked = Boolean(settings.wide);
    if (ui.settingHideSidebar) ui.settingHideSidebar.checked = Boolean(settings.hideSidebar);
    if (ui.settingSound) ui.settingSound.checked = state.soundEnabled;
    if (ui.settingFontSize) ui.settingFontSize.value = String(settings.fontSize || 16);
  };
  let chatSettings = { dark: false, wide: false, hideSidebar: false, sidebarCollapsed: false, youtubePreview: true, sound: true, fontSize: 16 };
  applyChatSettings(chatSettings);
  ui.chatSettingsButton?.addEventListener('click', () => {
    const opening = ui.chatSettings.hidden;
    ui.chatSettings.hidden = !opening;
    ui.chatSettingsButton.setAttribute('aria-expanded', String(opening));
  });
  const saveChatSettings = () => {
    chatSettings = {
      dark: false,
      wide: Boolean(ui.settingWide?.checked),
      hideSidebar: Boolean(ui.settingHideSidebar?.checked),
      sidebarCollapsed: document.documentElement.classList.contains('roomchat-sidebar-collapsed'),
      youtubePreview: Boolean(ui.settingYouTubePreview?.checked),
      sound: Boolean(ui.settingSound?.checked),
      fontSize: Number(ui.settingFontSize?.value || 16),
    };
    try { localStorage.setItem(settingKey, JSON.stringify(chatSettings)); } catch {}
    applyChatSettings(chatSettings);
  };
  const closeChatSettings = () => {
    if (ui.chatSettings) ui.chatSettings.hidden = true;
    ui.chatSettingsButton?.setAttribute('aria-expanded', 'false');
  };
  ui.chatSettingsClose?.addEventListener('click', closeChatSettings);
  ui.resetChatSettings?.addEventListener('click', () => {
    chatSettings = {
      dark: false,
      wide: false,
      hideSidebar: false,
      sidebarCollapsed: false,
      youtubePreview: true,
      sound: true,
      fontSize: 16,
    };
    applyChatSettings(chatSettings);
    try { localStorage.setItem(settingKey, JSON.stringify(chatSettings)); } catch {}
    renderMessages();
    showToast('화면 설정을 기본값으로 되돌렸어요.');
  });
  [ui.settingDark, ui.settingWide, ui.settingHideSidebar, ui.settingYouTubePreview, ui.settingSound, ui.settingFontSize].forEach((control) => control?.addEventListener('change', () => {
    saveChatSettings();
    if (control === ui.settingYouTubePreview) renderMessages();
  }));
  ui.sidebarCollapseButton?.addEventListener('click', () => {
    const next = !document.documentElement.classList.contains('roomchat-sidebar-collapsed');
    chatSettings.sidebarCollapsed = next;
    try { localStorage.setItem(settingKey, JSON.stringify(chatSettings)); } catch {}
    applyChatSettings(chatSettings);
  });
  ui.messageSearch?.addEventListener('input', () => {
    state.messageSearchQuery = ui.messageSearch.value;
    renderMessages();
  });
  ui.messageSearchDate?.addEventListener('change', () => {
    state.messageSearchDate = ui.messageSearchDate.value;
    renderMessages();
  });
  ui.messageSearchClear?.addEventListener('click', () => {
    if (ui.messageSearch) ui.messageSearch.value = '';
    if (ui.messageSearchDate) ui.messageSearchDate.value = '';
    state.messageSearchQuery = '';
    state.messageSearchDate = '';
    renderMessages();
    ui.messageSearch?.focus();
  });
  ui.clearNotificationHistory?.addEventListener('click', () => {
    state.notificationHistory = [];
    try { localStorage.removeItem('roomchat:notification-history'); } catch {}
    renderNotificationHistory();
    showToast('이 기기의 알림 기록을 초기화했어요.');
  });
  ui.messages.addEventListener('scroll', () => {
    if (ui.messages.scrollHeight - ui.messages.scrollTop - ui.messages.clientHeight < 60) clearUnreadRoomMessages();
  }, { passive: true });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      ui.messageSearch?.focus();
    }
    if (event.key === 'Escape' && ui.chatSettings && !ui.chatSettings.hidden) closeChatSettings();
  });
  window.addEventListener('offline', () => {
    setConnection(false, '오프라인');
    showToast('인터넷 연결이 끊겼어요. 연결이 복구되면 자동으로 다시 연결을 시도해요.');
  });
  window.addEventListener('online', () => {
    setConnection(false, '재연결 중');
    showToast('인터넷 연결이 복구됐어요. 채팅 서버에 다시 연결하고 있어요.');
  });
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
  ui.cancelReply.addEventListener('click', clearReplyTarget);
  ui.messageInput.addEventListener('input', () => {
    if (state.roomChannel && !isGuideRoom(state.room) && ui.messageInput.value.trim()) {
      const now = Date.now();
      if (now - state.typingLastSentAt > 1200) {
        state.typingLastSentAt = now;
        state.roomChannel.send({ type: 'broadcast', event: 'typing', payload: { sender: state.user?.id || `guest:${guestSessionId}`, nickname: state.nickname || '익명' } }).catch(() => {});
      }
    }
    updateMentionSuggestions();
    ui.messageInput.style.height = 'auto';
    ui.messageInput.style.height = `${Math.min(ui.messageInput.scrollHeight, 150)}px`;
    ui.charCount.textContent = `${ui.messageInput.value.length} / 2000`;
  });
  ui.messageInput.addEventListener('keydown', (event) => {
    if (!ui.mentionPopup.hidden && mentionItems.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); mentionActiveIndex = (mentionActiveIndex + 1) % mentionItems.length; renderMentionPopup(); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); mentionActiveIndex = (mentionActiveIndex - 1 + mentionItems.length) % mentionItems.length; renderMentionPopup(); return; }
      if (event.key === 'Escape') { closeMentionPopup(); return; }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); chooseMention(mentionItems[mentionActiveIndex]); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(event); }
  });
  ui.messageInput.addEventListener('click', updateMentionSuggestions);
  ui.messageInput.addEventListener('blur', () => window.setTimeout(closeMentionPopup, 120));
  ui.mentionPopup.addEventListener('mousedown', (event) => event.preventDefault());
  ui.imageFile.addEventListener('change', (event) => { chooseAttachment(event.target.files?.[0]); event.target.value = ''; });
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




function withStartupTimeout(promise, label, timeoutMs = 7000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(label + ' timed out after ' + timeoutMs + 'ms')), timeoutMs);
    }),
  ]).finally(() => window.clearTimeout(timer));
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
    let guestName = null;
    let guestError = null;
    try {
      const result = await withStartupTimeout(supabase.rpc('roomchat_refresh_guest', {
        p_guest_session_id: guestSessionId, p_guest_token: guestToken,
      }), 'Guest session refresh', 4000);
      guestName = result.data;
      guestError = result.error;
    } catch (error) {
      console.warn('Guest refresh delayed; continuing room startup:', error);
    }
    if (!guestError && guestName) {
      state.nickname = guestName;
      updateIdentityUI();
    }
  }
  try {
    window.__roomchatRouting = true;
    try { await withStartupTimeout(loadRooms(), 'Room list load', 10000); } finally { window.__roomchatRouting = false; }
    const initialRoute = routeKind();
    const routeRoom = findRoomForRoute(initialRoute);
    if (routeRoom && routeRoom.id !== state.room?.id) {
      window.__roomchatRouting = true;
      try { await switchRoom(routeRoom); } finally { window.__roomchatRouting = false; }
    }
    const sharedLinkParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    const sharedRoomId = sharedLinkParams.get('room');
    if (sharedRoomId) {
      const sharedRoom = state.rooms.find((room) => room.id === sharedRoomId);
      if (sharedRoom && sharedRoom.id !== state.room?.id) await switchRoom(sharedRoom);
    }
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
    console.error('Room bootstrap failed:', error);
    setConnection(false, '연결 확인 필요');
    showToast('채팅 서버에 연결하지 못했어요. Supabase 설정을 확인해 주세요.');
  }
  const initialRoute = routeKind();
  if (initialRoute.type === 'login') {
    ui.nicknameDialog.close();
    showAccountDialog();
  } else if (initialRoute.type === 'profile' && state.user) {
    social?.openProfile(state.user.id);
  } else if (initialRoute.type === 'friends' && state.user) {
    social?.openFriends();
  } else if (initialRoute.type === 'settings') {
    ui.nicknameButton.click();
  } else if (initialRoute.type === 'room' && !findRoomForRoute(initialRoute)) {
    showToast('해당 주소의 방을 찾을 수 없어요. 방 목록에서 선택해 주세요.');
  }
  if (!state.user && state.pendingAdminInvite) showAccountDialog();
  else if (!state.user && !state.nickname && initialRoute.type !== 'login') showNicknameDialog();
  window.addEventListener('popstate', async () => {
    const route = routeKind();
    if (route.type === 'room') {
      const room = findRoomForRoute(route);
      if (room) {
        window.__roomchatRouting = true;
        try { await switchRoom(room); } finally { window.__roomchatRouting = false; }
      }
    } else if (route.type === 'login') {
      ui.nicknameDialog.close(); showAccountDialog();
    } else if (route.type === 'profile' && state.user) social?.openProfile(state.user.id);
    else if (route.type === 'friends' && state.user) social?.openFriends();
    else if (route.type === 'settings') ui.nicknameButton.click();
  });
  state.identityTimer = window.setInterval(refreshIdentity, 45000);
}

social = initSocial({
  supabase, state, showToast, errorText, avatarPublicUrl, paintAvatar, makeAvatar, applyAvatars,
  makeAvatarBlob, notifyUser, getMentionNames,
});
let appLoadingHidden = false;
function hideAppLoading() {
  if (appLoadingHidden) return;
  appLoadingHidden = true;
  const loader = document.getElementById('app-loading');
  if (!loader) return;
  loader.classList.add('is-hidden');
  window.setTimeout(() => loader.remove(), 360);
}
// Never keep the entire app covered while a slow network request is pending.
// Boot continues in the background and updates the UI when data arrives.
const appLoadingFailsafe = window.setTimeout(hideAppLoading, 900);
// If Supabase never reports a channel status, show a useful state instead of "연결 중" forever.
let roomchatConnectionResolved = false;
const roomchatConnectionWatchdog = window.setTimeout(() => {
  if (roomchatConnectionResolved) return;
  setConnection(false, navigator.onLine ? '서버 응답 지연' : '오프라인');
  console.warn('RoomChat connection watchdog: no successful realtime subscription yet.');
}, 8000);
const markRoomchatConnected = () => {
  roomchatConnectionResolved = true;
  window.clearTimeout(roomchatConnectionWatchdog);
};
const originalSetConnection = setConnection;
setConnection = function(connected, label = connected ? '실시간 연결됨' : '연결 중') {
  if (connected) markRoomchatConnected();
  originalSetConnection(connected, label);
};
window.addEventListener('online', () => {
  if (!roomchatConnectionResolved) setConnection(false, '재연결 중');
});
window.addEventListener('offline', () => setConnection(false, '오프라인'));
boot().catch((error) => {
  console.error('RoomChat startup failed:', error);
  setConnection(false, '연결 확인 필요');
  showToast('초기 로딩이 지연되고 있어요. 연결 상태를 확인해 주세요.');
}).finally(() => {
  window.clearTimeout(appLoadingFailsafe);
  hideAppLoading();
});
