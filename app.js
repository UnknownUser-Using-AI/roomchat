import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  realtime: { params: { eventsPerSecond: 8 } },
});
const $ = (selector) => document.querySelector(selector);
const ui = {
  roomList: $('#room-list'), mobileRoomList: $('#mobile-room-list'),
  roomName: $('#current-room-name'), bannerName: $('#banner-room-name'),
  roomTopic: $('#room-topic'), presence: $('#presence-count'),
  messages: $('#message-list'), connection: $('#connection-state'),
  nicknameLabel: $('#nickname-label'), nicknameButton: $('#nickname-button'),
  nicknameDialog: $('#nickname-dialog'), nicknameForm: $('#nickname-form'), nicknameInput: $('#nickname-input'),
  roomDialog: $('#room-dialog'), roomForm: $('#room-form'), roomInput: $('#room-input'),
  notificationButton: $('#notification-button'), notificationLabel: $('#notification-label'),
  messageForm: $('#message-form'), messageInput: $('#message-input'), send: $('#send-button'),
  imageFile: $('#image-file'), preview: $('#attachment-preview'), thumbnail: $('#attachment-thumbnail'),
  attachmentName: $('#attachment-name'), removeAttachment: $('#remove-attachment'),
  toast: $('#toast'), charCount: $('#char-count'),
};
const state = {
  nickname: '', rooms: [], room: null, roomChannel: null, roomsChannel: null,
  messages: [], attachment: null, attachmentUrl: '', notifications: false,
  toastTimer: 0, roomRequest: 0, clientId: crypto.randomUUID(),
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('visible');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => ui.toast.classList.remove('visible'), 3000);
}
function setConnection(connected, label = connected ? '실시간 연결됨' : '연결 중') {
  ui.connection.classList.toggle('online', connected);
  ui.connection.innerHTML = `<i></i>${label}`;
}
function makeAvatar(name) {
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.style.setProperty('--avatar-hue', String(hue));
  avatar.textContent = [...name][0] || '•';
  return avatar;
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
function renderRoomLists() {
  for (const list of [ui.roomList, ui.mobileRoomList]) list.replaceChildren();
  state.rooms.forEach((room, index) => {
    const desktop = document.createElement('button');
    desktop.type = 'button';
    desktop.className = `room-item${state.room?.id === room.id ? ' active' : ''}`;
    desktop.setAttribute('aria-current', state.room?.id === room.id ? 'page' : 'false');
    const number = document.createElement('span');
    number.className = 'room-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('span');
    title.className = 'room-title';
    title.textContent = room.name;
    const arrow = document.createElement('span');
    arrow.className = 'room-arrow';
    arrow.textContent = '↗';
    desktop.append(number, title, arrow);
    desktop.addEventListener('click', () => switchRoom(room));
    ui.roomList.append(desktop);

    const mobile = document.createElement('button');
    mobile.type = 'button';
    mobile.className = `mobile-room-chip${state.room?.id === room.id ? ' active' : ''}`;
    mobile.textContent = room.name;
    mobile.addEventListener('click', () => switchRoom(room));
    ui.mobileRoomList.append(mobile);
  });
}
function renderMessage(message) {
  const key = String(message.id);
  if (ui.messages.querySelector(`[data-message-id="${CSS.escape(key)}"]`)) return;
  const empty = ui.messages.querySelector('.empty-state');
  empty?.remove();
  ui.messages.querySelector('.loading-state')?.remove();

  const row = document.createElement('article');
  row.className = `message-row${message.nickname === state.nickname ? ' own-message' : ''}`;
  row.dataset.messageId = key;
  row.append(makeAvatar(message.nickname || '익명'));
  const body = document.createElement('div');
  body.className = 'message-body';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const name = document.createElement('strong');
  name.textContent = message.nickname || '익명';
  const time = document.createElement('time');
  time.dateTime = message.created_at;
  time.textContent = formatTime(message.created_at);
  meta.append(name, time);
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
  ui.messages.append(row);
  ui.messages.scrollTop = ui.messages.scrollHeight;
}
function renderMessages() {
  ui.messages.replaceChildren();
  if (state.messages.length === 0) {
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
}
function updateRoomHeading(room) {
  ui.roomName.textContent = room.name;
  ui.bannerName.textContent = room.name;
  ui.roomTopic.textContent = `방 ${String(state.rooms.findIndex((item) => item.id === room.id) + 1).padStart(2, '0')} · 누구나 참여할 수 있어요`;
  renderRoomLists();
}
async function loadRooms() {
  const { data, error } = await supabase.from('rooms').select('id,name,created_at').order('created_at', { ascending: true }).limit(100);
  if (error) throw error;
  state.rooms = data || [];
  renderRoomLists();
  if (!state.room && state.rooms.length) await switchRoom(state.rooms[0]);
}
async function switchRoom(room) {
  if (!room || state.room?.id === room.id) return;
  state.room = room;
  const request = ++state.roomRequest;
  if (state.roomChannel) {
    const previous = state.roomChannel;
    state.roomChannel = null;
    await supabase.removeChannel(previous);
  }
  updateRoomHeading(room);
  state.messages = [];
  showLoading();
  ui.presence.textContent = '1';
  const { data, error } = await supabase.from('messages').select('id,room_id,nickname,content,image_path,created_at').eq('room_id', room.id).order('created_at', { ascending: true }).limit(100);
  if (request !== state.roomRequest) return;
  if (error) {
    ui.messages.replaceChildren();
    showToast('대화 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    console.error(error);
    return;
  }
  state.messages = data || [];
  renderMessages();
  if (!state.nickname) return;
  const channel = supabase.channel(`room:${room.id}`, { config: { presence: { key: state.clientId } } });
  channel
    .on('presence', { event: 'sync' }, () => {
      const count = Object.values(channel.presenceState()).reduce((sum, entries) => sum + entries.length, 0);
      ui.presence.textContent = String(Math.max(count, 1));
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${room.id}` }, ({ new: incoming }) => {
      addMessage(incoming);
      if (incoming.nickname !== state.nickname && state.notifications) notifyIncoming(incoming);
    })
    .subscribe(async (status) => {
      if (request !== state.roomRequest) return;
      if (status === 'SUBSCRIBED') {
        setConnection(true);
        const { error: presenceError } = await channel.track({ nickname: state.nickname, joinedAt: new Date().toISOString() });
        if (presenceError) console.warn('Presence track failed', presenceError);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setConnection(false, '재연결 중');
      }
    });
  state.roomChannel = channel;
}
async function createRoom(name) {
  const cleanName = name.trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 32) return showToast('방 이름은 2~32자로 입력해 주세요.');
  const { data, error } = await supabase.from('rooms').insert({ name: cleanName }).select('id,name,created_at').single();
  if (error) {
    showToast(error.code === '23505' ? '같은 이름의 방이 이미 있어요.' : '방을 만들지 못했어요.');
    console.error(error);
    return;
  }
  if (!state.rooms.some((room) => room.id === data.id)) state.rooms.push(data);
  state.rooms.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  renderRoomLists();
  await switchRoom(data);
  showToast(`“${data.name}” 방을 만들었어요.`);
}
function setNickname(name) {
  state.nickname = name.trim().slice(0, 24);
  ui.nicknameLabel.textContent = state.nickname;
  ui.nicknameButton.querySelector('.avatar-dot').textContent = [...state.nickname][0] || '•';
  ui.nicknameDialog.close();
  if (state.room) {
    const currentRoom = state.room;
    state.room = null;
    switchRoom(currentRoom);
  }
  else loadRooms().catch(showBackendError);
}
function showBackendError(error) {
  console.error(error);
  setConnection(false, '연결 확인 필요');
  showToast('채팅 서버에 연결하지 못했어요. Supabase 설정을 확인해 주세요.');
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
async function sendMessage(event) {
  event?.preventDefault();
  if (!state.nickname) {
    ui.nicknameDialog.showModal();
    return;
  }
  if (!state.room) return showToast('먼저 채팅방을 선택해 주세요.');
  const content = ui.messageInput.value.trim();
  const image = state.attachment;
  if (!content && !image) return;
  ui.send.disabled = true;
  ui.send.classList.add('sending');
  let imagePath = null;
  try {
    if (image) {
      const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' })[image.type] || 'img';
      imagePath = `${state.room.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('chat-images').upload(imagePath, image, {
        contentType: image.type, cacheControl: '3600', upsert: false,
      });
      if (uploadError) throw uploadError;
    }
    const { data, error } = await supabase.from('messages').insert({
      room_id: state.room.id, nickname: state.nickname,
      content: content || null, image_path: imagePath,
    }).select('id,room_id,nickname,content,image_path,created_at').single();
    if (error) throw error;
    addMessage(data);
    ui.messageInput.value = '';
    ui.messageInput.style.height = 'auto';
    ui.charCount.textContent = '0 / 2000';
    clearAttachment();
  } catch (error) {
    console.error(error);
    showToast(error.message?.includes('row-level security') ? '이미지 저장 권한을 확인해 주세요.' : '전송하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
  } finally {
    ui.send.disabled = false;
    ui.send.classList.remove('sending');
    ui.messageInput.focus();
  }
}
async function enableNotifications() {
  if (!('Notification' in window)) {
    showToast('이 브라우저는 알림 기능을 지원하지 않아요. 화면 안에서 새 메시지를 확인할 수 있어요.');
    return;
  }
  if (Notification.permission === 'denied') {
    showToast('브라우저 설정에서 이 사이트의 알림을 허용해 주세요.');
    return;
  }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    showToast('알림 권한이 허용되지 않았어요.');
    return;
  }
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
    } else {
      new Notification(title, { body, icon: './icon.svg', tag: `roomchat-${message.id}` });
    }
  } catch (error) {
    console.warn('Notification failed', error);
  }
}
function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker registration failed', error));
  }
}
function setupEvents() {
  ui.nicknameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = ui.nicknameInput.value.trim();
    if (!name) return;
    setNickname(name);
  });
  ui.nicknameButton.addEventListener('click', () => {
    ui.nicknameInput.value = state.nickname;
    ui.nicknameDialog.showModal();
    ui.nicknameInput.focus();
  });
  const openRoomDialog = () => {
    ui.roomInput.value = '';
    ui.roomDialog.showModal();
    ui.roomInput.focus();
  };
  $('#new-room-button').addEventListener('click', openRoomDialog);
  $('#mobile-new-room-button').addEventListener('click', openRoomDialog);
  $('#cancel-room').addEventListener('click', () => ui.roomDialog.close());
  ui.roomForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = ui.roomInput.value.trim();
    ui.roomDialog.close();
    createRoom(value);
  });
  ui.notificationButton.addEventListener('click', enableNotifications);
  ui.messageForm.addEventListener('submit', sendMessage);
  ui.messageInput.addEventListener('input', () => {
    ui.messageInput.style.height = 'auto';
    ui.messageInput.style.height = `${Math.min(ui.messageInput.scrollHeight, 150)}px`;
    ui.charCount.textContent = `${ui.messageInput.value.length} / 2000`;
  });
  ui.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage(event);
    }
  });
  ui.imageFile.addEventListener('change', (event) => chooseAttachment(event.target.files?.[0]));
  ui.removeAttachment.addEventListener('click', clearAttachment);
  ui.messageInput.addEventListener('paste', (event) => {
    const items = [...(event.clipboardData?.items || [])];
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    const file = imageItem?.getAsFile();
    if (file) {
      event.preventDefault();
      chooseAttachment(file);
      showToast('붙여넣은 이미지를 첨부했어요.');
    }
  });
  ui.messages.addEventListener('dragover', (event) => event.preventDefault());
  ui.messages.addEventListener('drop', (event) => {
    event.preventDefault();
    const image = [...(event.dataTransfer?.files || [])].find((file) => file.type.startsWith('image/'));
    if (image) chooseAttachment(image);
  });
}

async function boot() {
  setupEvents();
  registerServiceWorker();
  try {
    await loadRooms();
    state.roomsChannel = supabase.channel('public:rooms').on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'rooms',
    }, ({ new: room }) => {
      if (!state.rooms.some((item) => item.id === room.id)) {
        state.rooms.push(room);
        state.rooms.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        renderRoomLists();
      }
    }).subscribe();
  } catch (error) {
    showBackendError(error);
  }
  ui.nicknameDialog.showModal();
  window.setTimeout(() => ui.nicknameInput.focus(), 100);
}

boot();
