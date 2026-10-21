import { FONTS, fontStack, ensureFont } from './fonts.js?v=20261020-social';

const WEIGHTS = [[400, '보통'], [500, '조금 굵게'], [600, '중간'], [700, '굵게'], [800, '아주 굵게'], [900, '가장 굵게']];
const COLORS = ['#e05d5d', '#e8873f', '#d9a21b', '#8caf40', '#3aa56b', '#24a9a6', '#3b9bd6', '#5a6fe0',
  '#8a5ce0', '#c05cc2', '#e0558f', '#8b6b4a', '#5f6d67', '#1e2d2b'];
const HEX = /^#[0-9a-f]{6}$/iu;
const TAG_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const MAX_TAGS_WORN = 3;

function linkifyDmText(parent, content) {
  const pattern = /https?:\/\/[^\s<>"']+/giu;
  let last = 0;
  for (const match of String(content || '').matchAll(pattern)) {
    let url = match[0];
    while (/[.,!?;:)\]}]$/u.test(url)) url = url.slice(0, -1);
    if (match.index > last) parent.append(document.createTextNode(String(content).slice(last, match.index)));
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
      const link = document.createElement('a');
      link.href = parsed.href;
      link.target = window.matchMedia('(pointer: coarse)').matches ? '_self' : '_blank';
      link.rel = 'noopener noreferrer nofollow';
      link.className = 'chat-hyperlink';
      link.textContent = url;
      parent.append(link);
      if (match[0].length > url.length) parent.append(document.createTextNode(match[0].slice(url.length)));
    } catch { parent.append(document.createTextNode(match[0])); }
    last = match.index + match[0].length;
  }
  if (last < String(content).length) parent.append(document.createTextNode(String(content).slice(last)));
}


function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

// @닉네임 부분만 강조합니다. 내용은 항상 텍스트 노드로 넣어서 HTML이 끼어들 수 없어요.
export function renderMentions(content, names = [], selfName = '') {
  const fragment = document.createDocumentFragment();
  const list = [...new Set(['everyone', ...names.filter(Boolean)])].sort((a, b) => b.length - a.length).slice(0, 201);
  if (!content.includes('@')) { fragment.append(content); return fragment; }
  const pattern = new RegExp(`@(${list.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  let last = 0;
  for (const match of content.matchAll(pattern)) {
    if (match.index > last) fragment.append(content.slice(last, match.index));
    const span = document.createElement('span');
    span.className = `mention${match[1].toLocaleLowerCase() === 'everyone' ? ' mention-everyone' : match[1] === selfName ? ' mention-me' : ''}`;
    span.textContent = match[0];
    fragment.append(span);
    last = match.index + match[0].length;
  }
  if (last < content.length) fragment.append(content.slice(last));
  return fragment;
}

export function mentionsName(content, name) {
  return Boolean(typeof content === 'string' && (/@everyone(?![A-Za-z0-9_가-힣])/iu.test(content) || (name && content.includes(`@${name}`))));
}

export function initSocial(ctx) {
  const { supabase, state } = ctx;
  const profiles = state.profiles;
  const byId = (id) => document.getElementById(id);
  const el = {
    friendsButton: byId('friends-button'), friendsBadge: byId('friends-badge'),
    profileDialog: byId('profile-dialog'), profileClose: byId('profile-close'), profileBanner: byId('profile-banner'),
    profileAvatar: byId('profile-avatar'), profileStatus: byId('profile-status'), profileName: byId('profile-name'),
    profileTags: byId('profile-tags'), profileActions: byId('profile-actions'), profileJoined: byId('profile-joined'),
    profileRoles: byId('profile-roles'), profileBio: byId('profile-bio'), profileNoteWrap: byId('profile-note-wrap'),
    profileNote: byId('profile-note'), profileNoteState: byId('profile-note-state'),
    styleDialog: byId('style-dialog'), styleClose: byId('style-close'), styleForm: byId('style-form'),
    stylePreview: byId('style-preview'), styleFont: byId('style-font'), styleWeight: byId('style-weight'),
    styleColors: byId('style-colors'), styleColorCustom: byId('style-color-custom'), styleColorReset: byId('style-color-reset'),
    styleBio: byId('style-bio'), styleSave: byId('style-save'), tagGrid: byId('tag-grid'), tagName: byId('tag-name'),
    tagDrop: byId('tag-drop'), tagDropPreview: byId('tag-drop-preview'), tagFile: byId('tag-file'), tagCreate: byId('tag-create'),
    friendsDialog: byId('friends-dialog'), friendsClose: byId('friends-close'), friendsTitle: byId('friends-title'),
    friendsListView: byId('friends-list-view'), friendsList: byId('friends-list'), dmBack: byId('dm-back'),
    dmView: byId('dm-view'), dmThread: byId('dm-thread'), dmForm: byId('dm-form'), dmInput: byId('dm-input'),
    mentionPopup: byId('mention-popup'), messageInput: byId('message-input'),
  };
  const me = () => state.user?.id || null;
  const tagUrl = (path) => supabase.storage.from('tags').getPublicUrl(path).data.publicUrl;
  const formatDate = (value) => (value ? new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value)) : '알 수 없음');
  const formatTime = (value) => new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

  let friendRows = [];
  let online = new Set();
  let unread = new Map();
  let friendsTab = 'friends';
  let activeFriend = null;
  let thread = [];
  let socialChannel = null;
  let onlineChannel = null;
  let tagLibrary = [];
  let draft = null;
  let pendingTagFile = null;
  let pendingTagUrl = '';
  let openProfileId = null;
  let noteTargetId = null;
  let noteTimer = 0;

  /* ---------- 프로필 캐시와 꾸밈 ---------- */
  async function loadProfiles(ids, force = false) {
    const need = [...new Set((ids || []).filter((id) => id && (force || !profiles.has(id))))].slice(0, 100);
    if (!need.length) return;
    let result = await supabase.from('roomchat_profiles')
      .select('id,nickname,is_verified,created_at,avatar_path,bio,nick_font,nick_weight,nick_color').in('id', need);
    // 마이그레이션 전에도 아바타만큼은 계속 보이도록 예전 열만으로 한 번 더 시도합니다.
    if (result.error) result = await supabase.from('roomchat_profiles').select('id,nickname,is_verified,created_at,avatar_path').in('id', need);
    if (result.error) { need.forEach((id) => { if (!profiles.has(id)) profiles.set(id, { id, missing: true }); }); return; }
    const worn = new Map();
    const tagResult = await supabase.from('roomchat_user_tags').select('user_id,position,roomchat_tags(id,name,image_path)').in('user_id', need).order('position');
    if (!tagResult.error) {
      for (const row of tagResult.data || []) {
        if (!row.roomchat_tags) continue;
        if (!worn.has(row.user_id)) worn.set(row.user_id, []);
        worn.get(row.user_id).push(row.roomchat_tags);
      }
    }
    const found = new Set();
    for (const row of result.data || []) {
      found.add(row.id);
      profiles.set(row.id, { ...row, tags: worn.get(row.id) || [] });
      state.avatars.set(row.id, ctx.avatarPublicUrl(row.avatar_path));
    }
    need.filter((id) => !found.has(id)).forEach((id) => profiles.set(id, { id, missing: true }));
    ctx.applyAvatars();
    applyProfileStyles();
  }

  function styleNode(node, profile, kind) {
    if (!profile || profile.missing) return;
    if (profile.nick_font && ensureFont(profile.nick_font)) node.style.fontFamily = fontStack(profile.nick_font);
    if (kind === 'text') return;
    if (profile.nick_weight) node.style.fontWeight = String(profile.nick_weight);
    if (profile.nick_color && HEX.test(profile.nick_color)) node.style.color = profile.nick_color;
  }
  async function followTag(tag) {
    if (!me()) return ctx.showToast('태그를 따라 하려면 계정으로 로그인해 주세요.');
    if (!draft || !el.styleDialog.open) {
      openStyleDialog();
      if (!el.styleDialog.open || !draft) return;
    }
    if (draft.tags.includes(tag.id)) return ctx.showToast('이미 사용 중인 태그예요.');
    if (draft.tags.length >= MAX_TAGS_WORN) return ctx.showToast(`태그는 최대 ${MAX_TAGS_WORN}개까지 달 수 있어요.`);
    draft.tags.push(tag.id);
    renderTagGrid();
    ctx.showToast('태그를 선택했어요. 저장을 누르면 프로필에 적용돼요.');
  }
  function tagPill(tag) {
    const pill = document.createElement('span');
    pill.className = 'user-tag';
    pill.title = '';
    pill.tabIndex = 0;
    pill.setAttribute('aria-label', `${tag.name}, 일반 태그`);
    const image = document.createElement('img');
    image.src = tagUrl(tag.image_path);
    image.alt = '';
    image.loading = 'lazy';
    const label = document.createElement('b');
    label.textContent = tag.name;
    const card = document.createElement('span');
    card.className = 'tag-hover-card';
    card.setAttribute('role', 'group');
    const status = document.createElement('span');
    status.className = 'tag-hover-status';
    status.textContent = '일반 태그';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'tag-follow-button';
    copy.textContent = '태그 따라하기';
    copy.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      followTag(tag);
    });
    card.append(status, copy);
    pill.append(image, label, card);
    return pill;
  }
  function applyProfileStyles() {
    document.querySelectorAll('[data-style-user]').forEach((node) => styleNode(node, profiles.get(node.dataset.styleUser), node.dataset.styleKind));
    document.querySelectorAll('.tag-slot[data-user-id]').forEach((slot) => {
      const tags = profiles.get(slot.dataset.userId)?.tags || [];
      const key = tags.map((tag) => tag.id).join(',');
      if (slot.dataset.rendered === key) return;
      slot.dataset.rendered = key;
      slot.replaceChildren(...tags.map(tagPill));
    });
    if (me()) {
      const label = byId('nickname-label');
      if (label) styleNode(label, profiles.get(me()), 'name');
    }
  }

  /* ---------- 친구와 온라인 표시 ---------- */
  const otherId = (row) => (row.requester === me() ? row.addressee : row.requester);
  function relation(id) {
    const row = friendRows.find((item) => item.requester === id || item.addressee === id);
    if (!row) return 'none';
    if (row.status === 'accepted') return 'friends';
    return row.requester === me() ? 'outgoing' : 'incoming';
  }
  const friendIds = () => friendRows.filter((row) => row.status === 'accepted').map(otherId);
  const incomingRows = () => friendRows.filter((row) => row.status === 'pending' && row.addressee === me());
  const nameOf = (id) => profiles.get(id)?.nickname || '알 수 없는 사용자';
  const readKey = () => `roomchat:dm-read:${me()}`;
  function readMap() {
    try { return JSON.parse(localStorage.getItem(readKey()) || '{}') || {}; } catch { return {}; }
  }
  function markRead(friendId) {
    unread.delete(friendId);
    try { const map = readMap(); map[friendId] = new Date().toISOString(); localStorage.setItem(readKey(), JSON.stringify(map)); } catch { /* Storage is optional. */ }
    updateBadge();
  }
  function updateBadge() {
    const total = [...unread.values()].reduce((sum, count) => sum + count, 0) + incomingRows().length;
    el.friendsBadge.hidden = total === 0;
    el.friendsBadge.textContent = total > 99 ? '99+' : String(total);
  }

  async function loadFriends() {
    if (!me()) return;
    const { data, error } = await supabase.from('roomchat_friendships').select('id,requester,addressee,status,created_at');
    if (error) return;
    friendRows = data || [];
    await loadProfiles(friendRows.map(otherId));
    updateBadge();
    renderFriendsList();
    if (openProfileId) renderProfileActions(openProfileId);
  }
  async function loadUnread() {
    const { data, error } = await supabase.from('roomchat_dms').select('sender,created_at').eq('recipient', me())
      .order('created_at', { ascending: false }).limit(200);
    if (error) return;
    const map = readMap();
    unread = new Map();
    for (const row of data || []) {
      if (map[row.sender] && new Date(row.created_at) <= new Date(map[row.sender])) continue;
      unread.set(row.sender, (unread.get(row.sender) || 0) + 1);
    }
    updateBadge();
  }

  async function friendCall(name, args, success) {
    const { error } = await supabase.rpc(name, args);
    if (error) { ctx.showToast(ctx.errorText(error, '친구 요청을 처리하지 못했어요.')); return false; }
    if (success) ctx.showToast(success);
    await loadFriends();
    return true;
  }
  const requestFriend = (id) => friendCall('roomchat_friend_request', { p_target: id }, '친구 요청을 보냈어요. 상대가 수락하면 친구가 돼요.');
  const respondFriend = (id, accept) => friendCall('roomchat_friend_respond', { p_other: id, p_accept: accept }, accept ? '친구가 되었어요.' : '요청을 거절했어요.');
  const removeFriend = (id) => friendCall('roomchat_friend_remove', { p_other: id }, '친구 목록에서 지웠어요.');

  function statusDot(isOnline) {
    const dot = document.createElement('span');
    dot.className = `status-dot ${isOnline ? 'is-online' : 'is-offline'}`;
    dot.title = isOnline ? '온라인' : '오프라인';
    return dot;
  }
  function personRow(id, subtitle, actions, isOnline) {
    const row = document.createElement('div');
    row.className = 'friend-row';
    const avatar = document.createElement('span');
    avatar.className = 'avatar-wrap';
    avatar.append(ctx.makeAvatar(nameOf(id), id));
    if (isOnline !== undefined) avatar.append(statusDot(isOnline));
    const copy = document.createElement('div');
    copy.className = 'friend-copy';
    const name = document.createElement('strong');
    name.dataset.styleUser = id;
    name.textContent = nameOf(id);
    styleNode(name, profiles.get(id), 'name');
    const sub = document.createElement('span');
    sub.textContent = subtitle;
    copy.append(name, sub);
    row.append(avatar, copy, ...actions);
    return row;
  }
  function smallButton(label, className, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `admin-action ${className || ''}`;
    button.textContent = label;
    button.addEventListener('click', (event) => { event.stopPropagation(); handler(); });
    return button;
  }
  function renderFriendsList() {
    if (!el.friendsDialog.open) return;
    document.querySelectorAll('[data-friends-tab]').forEach((tab) => {
      const active = tab.dataset.friendsTab === friendsTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.textContent = tab.dataset.friendsTab === 'friends' ? `친구 ${friendIds().length}` : `요청 ${friendRows.filter((r) => r.status === 'pending').length}`;
    });
    el.friendsList.replaceChildren();
    if (friendsTab === 'friends') {
      const ids = friendIds().sort((a, b) => Number(online.has(b)) - Number(online.has(a)) || nameOf(a).localeCompare(nameOf(b), 'ko'));
      if (!ids.length) el.friendsList.append(emptyNote('아직 친구가 없어요. 이름이나 사진을 눌러 프로필을 열고 “친구 추가”를 눌러 보세요.'));
      for (const id of ids) {
        const count = unread.get(id) || 0;
        const isOnline = online.has(id);
        const row = personRow(id, isOnline ? '온라인' : '오프라인', [
          ...(count ? [Object.assign(document.createElement('span'), { className: 'unread-pill', textContent: String(count) })] : []),
          smallButton('DM', '', () => openThread(id)),
        ], isOnline);
        row.addEventListener('click', () => openThread(id));
        el.friendsList.append(row);
      }
      return;
    }
    const pending = friendRows.filter((row) => row.status === 'pending');
    if (!pending.length) el.friendsList.append(emptyNote('대기 중인 친구 요청이 없어요.'));
    for (const row of pending) {
      const id = otherId(row);
      const incoming = row.addressee === me();
      el.friendsList.append(personRow(id, incoming ? '나에게 온 요청' : '내가 보낸 요청', incoming
        ? [smallButton('수락', '', () => respondFriend(id, true)), smallButton('거절', 'danger-action', () => respondFriend(id, false))]
        : [smallButton('취소', 'danger-action', () => removeFriend(id))]));
    }
  }
  function emptyNote(text) {
    const note = document.createElement('div');
    note.className = 'member-empty';
    note.textContent = text;
    return note;
  }

  /* ---------- DM ---------- */
  async function openThread(friendId) {
    if (relation(friendId) !== 'friends') return ctx.showToast('친구끼리만 DM을 보낼 수 있어요.');
    activeFriend = friendId;
    if (!el.friendsDialog.open) el.friendsDialog.showModal();
    el.friendsListView.hidden = true;
    el.dmView.hidden = false;
    el.dmBack.hidden = false;
    el.friendsTitle.textContent = nameOf(friendId);
    thread = [];
    renderThread();
    const mine = me();
    const { data, error } = await supabase.from('roomchat_dms').select('id,sender,recipient,content,created_at')
      .or(`and(sender.eq.${mine},recipient.eq.${friendId}),and(sender.eq.${friendId},recipient.eq.${mine})`)
      .order('created_at', { ascending: false }).limit(100);
    if (activeFriend !== friendId) return;
    if (error) { ctx.showToast('대화를 불러오지 못했어요.'); return; }
    thread = (data || []).reverse();
    renderThread();
    markRead(friendId);
    if (!window.matchMedia('(pointer: coarse)').matches) el.dmInput.focus();
  }
  function closeThread() {
    activeFriend = null;
    el.dmView.hidden = true;
    el.dmBack.hidden = true;
    el.friendsListView.hidden = false;
    el.friendsTitle.textContent = '친구';
    renderFriendsList();
  }
  function renderThread() {
    el.dmThread.replaceChildren();
    if (!thread.length) el.dmThread.append(emptyNote('첫 메시지를 보내 보세요.'));
    for (const dm of thread) {
      const row = document.createElement('div');
      row.className = `dm-row${dm.sender === me() ? ' own' : ''}`;
      const bubble = document.createElement('p');
      bubble.className = 'dm-bubble';
      linkifyDmText(bubble, dm.content);
      const time = document.createElement('time');
      time.textContent = formatTime(dm.created_at);
      row.append(bubble, time);
      el.dmThread.append(row);
    }
    el.dmThread.scrollTop = el.dmThread.scrollHeight;
  }
  async function sendDm(event) {
    event.preventDefault();
    const text = el.dmInput.value.trim();
    if (!text || !activeFriend) return;
    el.dmInput.disabled = true;
    const { data, error } = await supabase.rpc('roomchat_send_dm', { p_to: activeFriend, p_content: text });
    el.dmInput.disabled = false;
    if (error) { ctx.showToast(ctx.errorText(error, 'DM을 보내지 못했어요.')); el.dmInput.focus(); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row && !thread.some((item) => String(item.id) === String(row.id))) thread.push(row);
    el.dmInput.value = '';
    renderThread();
    el.dmInput.focus();
  }
  async function onIncomingDm(dm) {
    await loadProfiles([dm.sender]);
    const viewing = el.friendsDialog.open && activeFriend === dm.sender;
    if (viewing) {
      if (!thread.some((item) => String(item.id) === String(dm.id))) thread.push(dm);
      renderThread();
      markRead(dm.sender);
    } else {
      unread.set(dm.sender, (unread.get(dm.sender) || 0) + 1);
      updateBadge();
      renderFriendsList();
      ctx.showToast(`${nameOf(dm.sender)}님의 DM: ${dm.content.slice(0, 40)}`);
    }
    ctx.notifyUser(`${nameOf(dm.sender)} · DM`, dm.content, `dm-${dm.id}`);
  }
  async function onFriendshipChange(payload) {
    const row = payload.new;
    await loadFriends();
    if (payload.eventType === 'INSERT' && row?.addressee === me()) {
      await loadProfiles([row.requester]);
      ctx.showToast(`${nameOf(row.requester)}님이 친구 요청을 보냈어요.`);
      ctx.notifyUser('친구 요청', `${nameOf(row.requester)}님이 친구 요청을 보냈어요.`, `fr-${row.id}`);
    } else if (payload.eventType === 'UPDATE' && row?.status === 'accepted' && row.requester === me()) {
      ctx.showToast(`${nameOf(row.addressee)}님이 친구 요청을 수락했어요.`);
    }
  }

  function subscribeOnline() {
    onlineChannel = supabase.channel('roomchat-online', { config: { presence: { key: me() } } });
    onlineChannel.on('presence', { event: 'sync' }, () => {
      online = new Set(Object.keys(onlineChannel.presenceState()));
      renderFriendsList();
      if (openProfileId) renderProfileStatus(openProfileId);
    }).subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await onlineChannel.track({ online_at: new Date().toISOString() });
    });
  }
  function start() {
    stop();
    if (!me()) return;
    el.friendsButton.hidden = false;
    loadProfiles([me()], true);
    loadFriends().then(loadUnread);
    subscribeOnline();
    socialChannel = supabase.channel(`roomchat-social:${me()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'roomchat_dms', filter: `recipient=eq.${me()}` }, ({ new: dm }) => onIncomingDm(dm))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roomchat_friendships' }, (payload) => onFriendshipChange(payload))
      .subscribe();
  }
  function stop() {
    if (socialChannel) supabase.removeChannel(socialChannel);
    if (onlineChannel) supabase.removeChannel(onlineChannel);
    socialChannel = null;
    onlineChannel = null;
    friendRows = [];
    online = new Set();
    unread = new Map();
    activeFriend = null;
    el.friendsButton.hidden = true;
    if (el.friendsDialog.open) el.friendsDialog.close();
    updateBadge();
  }
  function openFriends() {
    if (!me()) return ctx.showToast('친구와 DM은 계정으로 로그인하면 쓸 수 있어요.');
    friendsTab = incomingRows().length && !friendIds().length ? 'requests' : friendsTab;
    closeThreadView();
    el.friendsDialog.showModal();
    renderFriendsList();
    loadFriends();
  }
  function closeThreadView() {
    activeFriend = null;
    el.dmView.hidden = true;
    el.dmBack.hidden = true;
    el.friendsListView.hidden = false;
    el.friendsTitle.textContent = '친구';
  }

  /* ---------- 프로필 카드 ---------- */
  function renderProfileStatus(id) {
    const show = id === me() || relation(id) === 'friends';
    el.profileStatus.hidden = !show;
    if (show) {
      const isOnline = id === me() || online.has(id);
      el.profileStatus.className = `status-dot profile-status ${isOnline ? 'is-online' : 'is-offline'}`;
      el.profileStatus.title = isOnline ? '온라인' : '오프라인';
    }
  }
  function renderProfileActions(id) {
    const box = el.profileActions;
    box.replaceChildren();
    const add = (label, className, handler) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `profile-action ${className || ''}`;
      button.textContent = label;
      button.addEventListener('click', handler);
      box.append(button);
    };
    if (!me()) {
      const hint = document.createElement('p');
      hint.className = 'profile-hint';
      hint.textContent = '계정을 만들면 친구를 추가하고 메모를 남길 수 있어요.';
      box.append(hint);
      return;
    }
    if (id === me()) { add('프로필 꾸미기', 'primary', () => { el.profileDialog.close(); openStyleDialog(); }); return; }
    const status = relation(id);
    if (status === 'none') add('친구 추가', 'primary', () => requestFriend(id));
    if (status === 'outgoing') add('요청 취소', '', () => removeFriend(id));
    if (status === 'incoming') { add('요청 수락', 'primary', () => respondFriend(id, true)); add('거절', '', () => respondFriend(id, false)); }
    if (status === 'friends') { add('DM 보내기', 'primary', () => { el.profileDialog.close(); openThread(id); }); add('친구 삭제', 'danger', () => { if (window.confirm(`${nameOf(id)}님을 친구에서 지울까요?`)) removeFriend(id); }); }
    renderProfileStatus(id);
  }
  async function openProfile(userId) {
    if (!userId) return;
    await loadProfiles([userId], true);
    const profile = profiles.get(userId);
    if (!profile || profile.missing) return ctx.showToast('이 사용자의 프로필을 찾을 수 없어요.');
    openProfileId = userId;
    noteTargetId = userId;
    el.profileBanner.style.background = profile.is_verified
      ? 'linear-gradient(95deg,#ef5467,#ee9e3a,#8caf40,#24a9a6,#6b7bea,#c05cc2)'
      : (profile.nick_color && HEX.test(profile.nick_color) ? profile.nick_color : '#cfd8d3');
    ctx.paintAvatar(el.profileAvatar, profile.nickname, ctx.avatarPublicUrl(profile.avatar_path));
    el.profileName.textContent = profile.nickname;
    el.profileName.className = `profile-name${profile.is_verified ? ' admin-name' : ''}`;
    el.profileName.style.cssText = '';
    styleNode(el.profileName, profile, 'name');
    el.profileTags.replaceChildren(...(profile.tags || []).map(tagPill));
    el.profileJoined.textContent = formatDate(profile.created_at);
    const roles = [];
    if (profile.is_verified) roles.push(['[인증됨] 관리자', 'role-admin']);
    if (state.room?.created_by === userId) roles.push([`방장 · ${state.room.name}`, 'role-owner']);
    roles.push(['계정 회원', 'role-member']);
    el.profileRoles.replaceChildren(...roles.map(([label, cls]) => Object.assign(document.createElement('span'), { className: `role-chip ${cls}`, textContent: label })));
    el.profileBio.textContent = profile.bio || '아직 소개가 없어요.';
    const canNote = Boolean(me()) && userId !== me();
    el.profileNoteWrap.hidden = !canNote;
    el.profileNote.value = '';
    el.profileNoteState.textContent = '';
    if (canNote) {
      supabase.from('roomchat_user_notes').select('note').eq('target_id', userId).maybeSingle()
        .then(({ data }) => { if (openProfileId === userId) el.profileNote.value = data?.note || ''; });
    }
    renderProfileActions(userId);
    renderProfileStatus(userId);
    if (!el.profileDialog.open) el.profileDialog.showModal();
  }
  async function saveNote() {
    if (!noteTargetId || !me() || noteTargetId === me() || el.profileNoteWrap.hidden) return;
    const { error } = await supabase.rpc('roomchat_set_note', { p_target: noteTargetId, p_note: el.profileNote.value });
    el.profileNoteState.textContent = error ? '메모를 저장하지 못했어요.' : '저장했어요';
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => { el.profileNoteState.textContent = ''; }, 2200);
  }

  /* ---------- 프로필 꾸미기 · 태그 ---------- */
  function renderStyleControls() {
    el.styleColors.replaceChildren();
    for (const color of COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = `color-swatch${draft.color === color ? ' active' : ''}`;
      swatch.style.background = color;
      swatch.setAttribute('aria-label', `닉네임 색 ${color}`);
      swatch.addEventListener('click', () => { draft.color = color; renderStyleControls(); });
      el.styleColors.append(swatch);
    }
    if (draft.color && HEX.test(draft.color)) el.styleColorCustom.value = draft.color;
    updateStylePreview();
  }
  function updateStylePreview() {
    const node = el.stylePreview;
    node.textContent = state.nickname || '닉네임';
    node.style.cssText = '';
    if (draft.font && ensureFont(draft.font)) node.style.fontFamily = fontStack(draft.font);
    if (draft.weight) node.style.fontWeight = String(draft.weight);
    if (draft.color && HEX.test(draft.color) && !state.isVerified) node.style.color = draft.color;
    node.classList.toggle('admin-name', state.isVerified);
  }
  async function loadTagLibrary() {
    const { data, error } = await supabase.from('roomchat_tags').select('id,name,image_path,created_by').order('created_at', { ascending: false }).limit(200);
    tagLibrary = error ? [] : data || [];
    renderTagGrid();
  }
  function renderTagGrid() {
    el.tagGrid.replaceChildren();
    if (!tagLibrary.length) el.tagGrid.append(emptyNote('아직 만들어진 태그가 없어요. 아래에서 첫 태그를 만들어 보세요.'));
    for (const tag of tagLibrary) {
      const wrap = document.createElement('div');
      wrap.className = 'tag-choice';
      const pick = document.createElement('button');
      pick.type = 'button';
      const selected = draft.tags.includes(tag.id);
      pick.className = `tag-pick${selected ? ' active' : ''}`;
      pick.setAttribute('aria-pressed', String(selected));
      pick.append(tagPill(tag));
      pick.addEventListener('click', () => {
        if (draft.tags.includes(tag.id)) draft.tags = draft.tags.filter((id) => id !== tag.id);
        else if (draft.tags.length >= MAX_TAGS_WORN) return ctx.showToast(`태그는 최대 ${MAX_TAGS_WORN}개까지 달 수 있어요.`);
        else draft.tags.push(tag.id);
        renderTagGrid();
      });
      wrap.append(pick);
      if (tag.created_by === me() || state.isAdmin) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'tag-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `${tag.name} 태그 삭제`);
        remove.addEventListener('click', () => deleteTag(tag));
        wrap.append(remove);
      }
      el.tagGrid.append(wrap);
    }
  }
  async function deleteTag(tag) {
    if (!window.confirm(`“${tag.name}” 태그를 삭제할까요? 이 태그를 쓰는 모든 사람에게서 사라져요.`)) return;
    const { data: path, error } = await supabase.rpc('roomchat_delete_tag', { p_tag_id: tag.id });
    if (error) return ctx.showToast(ctx.errorText(error, '태그를 삭제하지 못했어요.'));
    if (path) supabase.storage.from('tags').remove([path]).catch(() => {});
    tagLibrary = tagLibrary.filter((item) => item.id !== tag.id);
    draft.tags = draft.tags.filter((id) => id !== tag.id);
    profiles.forEach((profile) => { if (profile.tags) profile.tags = profile.tags.filter((item) => item.id !== tag.id); });
    renderTagGrid();
    applyProfileStyles();
  }
  function setPendingTagFile(file) {
    if (!file) return;
    if (!TAG_IMAGE_TYPES.includes(file.type)) return ctx.showToast('JPEG, PNG, WebP, GIF, AVIF 이미지만 쓸 수 있어요.');
    if (file.size > 12 * 1024 * 1024) return ctx.showToast('이미지는 12MB 이하로 선택해 주세요.');
    if (pendingTagUrl) URL.revokeObjectURL(pendingTagUrl);
    pendingTagFile = file;
    pendingTagUrl = URL.createObjectURL(file);
    el.tagDropPreview.src = pendingTagUrl;
    el.tagDrop.classList.add('has-image');
  }
  function clearPendingTag() {
    if (pendingTagUrl) URL.revokeObjectURL(pendingTagUrl);
    pendingTagFile = null;
    pendingTagUrl = '';
    el.tagDropPreview.removeAttribute('src');
    el.tagDrop.classList.remove('has-image');
    el.tagFile.value = '';
  }
  async function createTag() {
    const name = el.tagName.value.trim();
    if (!name) return ctx.showToast('태그 이름을 입력해 주세요.');
    if (!pendingTagFile) return ctx.showToast('태그 이미지를 골라 주세요.');
    el.tagCreate.disabled = true;
    let path = null;
    try {
      const blob = await ctx.makeAvatarBlob(pendingTagFile, 128, 300 * 1024);
      const extension = ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' })[blob.type];
      path = `${me()}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('tags').upload(path, blob, { contentType: blob.type, cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;
      const { data, error } = await supabase.rpc('roomchat_create_tag', { p_name: name, p_image_path: path });
      if (error) throw error;
      const tag = Array.isArray(data) ? data[0] : data;
      tagLibrary.unshift({ id: tag.id, name: tag.name, image_path: tag.image_path, created_by: me() });
      if (draft.tags.length < MAX_TAGS_WORN) draft.tags.push(tag.id);
      el.tagName.value = '';
      clearPendingTag();
      renderTagGrid();
      ctx.showToast('태그를 만들었어요. 저장을 누르면 내 이름 옆에 붙어요.');
    } catch (error) {
      if (path) await supabase.storage.from('tags').remove([path]).catch(() => {});
      ctx.showToast(ctx.errorText(error, '태그를 만들지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally { el.tagCreate.disabled = false; }
  }
  function openStyleDialog() {
    if (!me()) return ctx.showToast('프로필 꾸미기는 계정으로 로그인하면 쓸 수 있어요.');
    const profile = profiles.get(me()) || {};
    draft = {
      font: profile.nick_font || '', weight: profile.nick_weight || 0, color: profile.nick_color || '',
      bio: profile.bio || '', tags: (profile.tags || []).map((tag) => tag.id),
    };
    if (!el.styleFont.options.length) {
      el.styleFont.append(new Option('기본 글꼴', ''));
      FONTS.forEach((font) => el.styleFont.append(new Option(font.name, font.name)));
      el.styleWeight.append(new Option('기본 굵기', '0'));
      WEIGHTS.forEach(([value, label]) => el.styleWeight.append(new Option(`${label} (${value})`, String(value))));
    }
    el.styleFont.value = draft.font;
    el.styleWeight.value = String(draft.weight || 0);
    el.styleBio.value = draft.bio;
    clearPendingTag();
    renderStyleControls();
    renderTagGrid();
    loadTagLibrary();
    el.styleDialog.showModal();
  }
  async function saveStyle(event) {
    event.preventDefault();
    el.styleSave.disabled = true;
    try {
      const { error } = await supabase.rpc('roomchat_update_my_style', {
        p_font: draft.font || null, p_weight: draft.weight || null, p_color: draft.color || null,
        p_bio: el.styleBio.value.replace(/\s+/gu, ' ').trim() || null,
      });
      if (error) throw error;
      const { error: tagError } = await supabase.rpc('roomchat_set_my_tags', { p_tag_ids: draft.tags });
      if (tagError) throw tagError;
      await loadProfiles([me()], true);
      el.styleDialog.close();
      ctx.showToast('프로필을 저장했어요.');
    } catch (error) {
      ctx.showToast(ctx.errorText(error, '프로필을 저장하지 못했어요. 마이그레이션이 적용됐는지 확인해 주세요.'));
    } finally { el.styleSave.disabled = false; }
  }

  /* ---------- 멘션 자동완성 ---------- */
  let mentionItems = [];
  let mentionActive = 0;
  const mentionOpen = () => !el.mentionPopup.hidden;
  function closeMentions() { el.mentionPopup.hidden = true; mentionItems = []; }
  function renderMentionPopup() {
    el.mentionPopup.replaceChildren();
    mentionItems.forEach((name, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `mention-option${index === mentionActive ? ' active' : ''}`;
      option.textContent = `@${name}`;
      option.addEventListener('mousedown', (event) => { event.preventDefault(); pickMention(name); });
      el.mentionPopup.append(option);
    });
    el.mentionPopup.hidden = false;
  }
  function mentionQuery() {
    const input = el.messageInput;
    const before = input.value.slice(0, input.selectionStart);
    const match = before.match(/(^|\s)@([^\s@]{0,20})$/u);
    return match ? { query: match[2], start: before.length - match[2].length - 1 } : null;
  }
  function refreshMentions() {
    const found = mentionQuery();
    if (!found) return closeMentions();
    const query = found.query.toLowerCase();
    mentionItems = ctx.getMentionNames()
      .filter((name) => name !== state.nickname && name.toLowerCase().includes(query))
      .sort((a, b) => Number(b.toLowerCase().startsWith(query)) - Number(a.toLowerCase().startsWith(query)))
      .slice(0, 6);
    if (!mentionItems.length) return closeMentions();
    mentionActive = 0;
    renderMentionPopup();
  }
  function pickMention(name) {
    const found = mentionQuery();
    if (!found) return closeMentions();
    const input = el.messageInput;
    const after = input.value.slice(input.selectionStart);
    input.value = `${input.value.slice(0, found.start)}@${name} ${after}`;
    const caret = found.start + name.length + 2;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    closeMentions();
  }

  /* ---------- 이벤트 연결 ---------- */
  function bindDialogBackdrop(dialog) {
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  }
  el.friendsButton.addEventListener('click', openFriends);
  el.friendsClose.addEventListener('click', () => el.friendsDialog.close());
  el.dmBack.addEventListener('click', closeThread);
  el.dmForm.addEventListener('submit', sendDm);
  el.dmInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendDm(event); }
  });
  document.querySelectorAll('[data-friends-tab]').forEach((tab) => tab.addEventListener('click', () => { friendsTab = tab.dataset.friendsTab; renderFriendsList(); }));
  el.profileClose.addEventListener('click', () => el.profileDialog.close());
  el.profileDialog.addEventListener('close', () => { saveNote(); openProfileId = null; });
  el.profileNote.addEventListener('blur', saveNote);
  el.styleClose.addEventListener('click', () => el.styleDialog.close());
  el.styleForm.addEventListener('submit', saveStyle);
  el.styleFont.addEventListener('change', () => { draft.font = el.styleFont.value; updateStylePreview(); });
  el.styleWeight.addEventListener('change', () => { draft.weight = Number(el.styleWeight.value) || 0; updateStylePreview(); });
  el.styleBio.addEventListener('input', () => { draft.bio = el.styleBio.value; });
  el.styleColorCustom.addEventListener('input', () => { draft.color = el.styleColorCustom.value; renderStyleControls(); });
  el.styleColorReset.addEventListener('click', () => { draft.color = ''; renderStyleControls(); });
  el.tagCreate.addEventListener('click', createTag);
  el.tagFile.addEventListener('change', (event) => setPendingTagFile(event.target.files?.[0]));
  el.tagDrop.addEventListener('click', () => el.tagFile.click());
  el.tagDrop.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.tagFile.click(); } });
  ['dragenter', 'dragover'].forEach((name) => el.tagDrop.addEventListener(name, (event) => { event.preventDefault(); el.tagDrop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((name) => el.tagDrop.addEventListener(name, () => el.tagDrop.classList.remove('dragging')));
  el.tagDrop.addEventListener('drop', (event) => {
    event.preventDefault();
    setPendingTagFile([...(event.dataTransfer?.files || [])].find((file) => file.type.startsWith('image/')));
  });
  // 프로필 꾸미기 창이 열려 있을 때 Ctrl+V로 붙여넣은 이미지를 태그 이미지로 사용합니다.
  document.addEventListener('paste', (event) => {
    if (!el.styleDialog.open) return;
    const file = [...(event.clipboardData?.items || [])].find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    if (!file) return;
    event.preventDefault();
    setPendingTagFile(file);
    ctx.showToast('붙여넣은 이미지를 태그 이미지로 골랐어요.');
  });
  [el.profileDialog, el.styleDialog, el.friendsDialog].forEach(bindDialogBackdrop);

  el.messageInput.addEventListener('input', refreshMentions);
  el.messageInput.addEventListener('click', refreshMentions);
  el.messageInput.addEventListener('blur', () => window.setTimeout(closeMentions, 120));
  el.messageInput.addEventListener('keydown', (event) => {
    if (!mentionOpen() || event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopImmediatePropagation();
      mentionActive = (mentionActive + (event.key === 'ArrowDown' ? 1 : -1) + mentionItems.length) % mentionItems.length;
      renderMentionPopup();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopImmediatePropagation();
      pickMention(mentionItems[mentionActive]);
    } else if (event.key === 'Escape') {
      event.stopImmediatePropagation();
      closeMentions();
    }
  });

  return { loadProfiles, applyProfileStyles, openProfile, openStyleDialog, start, stop, openFriends };
}
