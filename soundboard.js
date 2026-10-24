function isAllowedSoundUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'myinstants.com' || url.hostname === 'www.myinstants.com') && url.pathname.startsWith('/media/sounds/');
  } catch { return false; }
}
const API_BASE = 'https://losuyalyjcurntylbwgy.supabase.co/functions/v1/myinstants-proxy';
const SUPABASE_PUBLIC_KEY = 'sb_publishable_VopMfIi4AwCelhTcp_88mg_dh2s6Ael';
const dialog = document.getElementById('soundboard-dialog');
const openButton = document.getElementById('soundboard-button');
const closeButton = document.getElementById('soundboard-close');
const searchForm = document.getElementById('soundboard-search-form');
const queryInput = document.getElementById('soundboard-query');
const resultsEl = document.getElementById('soundboard-results');
const statusEl = document.getElementById('soundboard-status');
const volumeInput = document.getElementById('soundboard-volume');
const stopButton = document.getElementById('soundboard-stop');
const tabButtons = [...document.querySelectorAll('[data-sound-tab]')];
let currentTab = 'popular';
let currentItems = [];
let currentAudio = null;
let requestId = 0;
const cache = new Map();
const FAVORITES_KEY = 'roomchat.myinstants.favorites.v1';
const getFavorites = () => {
  try { const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
};
const setFavorites = (value) => {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(value)); } catch {}
};
const normalizeItems = (payload) => {
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : [];
  return data.map((item) => ({
    id: String(item.id || item.mp3 || item.url || item.title || Math.random()),
    title: String(item.title || item.name || '이름 없는 사운드'),
    mp3: String(item.mp3 || item.sound || item.audio || ''),
    url: String(item.url || 'https://www.myinstants.com/')
  })).filter((item) => item.mp3.startsWith('https://www.myinstants.com/media/sounds/') || item.mp3.startsWith('https://myinstants.com/media/sounds/'));
};
async function fetchSounds(endpoint, params = {}) {
  const url = new URL(API_BASE);
  url.searchParams.set('endpoint', endpoint.slice(1));
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const key = url.toString();
  if (cache.has(key)) return cache.get(key);
  const response = await fetch(key, { headers: { Accept: 'application/json', apikey: SUPABASE_PUBLIC_KEY }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) { let detail = ''; try { const body = await response.clone().json(); detail = body?.message || body?.detail || ''; } catch {} throw new Error('사운드 API 오류 (' + response.status + ')' + (detail ? ': ' + detail : '')); }
  const payload = await response.json();
  if (payload?.status && Number(payload.status) >= 400) throw new Error(payload.message || '사운드를 불러오지 못했어요.');
  const items = normalizeItems(payload);
  cache.set(key, items);
  return items;
}
function setStatus(message) { statusEl.textContent = message; }
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function renderItems(items) {
  currentItems = items;
  resultsEl.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'soundboard-status';
    empty.textContent = currentTab === 'favorites' ? '즐겨찾기한 사운드가 없어요. 별표를 눌러 저장해 보세요.' : '검색 결과가 없어요. 다른 검색어를 입력해 보세요.';
    resultsEl.append(empty);
    return;
  }
  const favorites = getFavorites();
  items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'soundboard-item';
    const play = document.createElement('button');
    play.type = 'button'; play.className = 'soundboard-item'; play.style.cssText = 'padding:0;border:0;background:transparent;flex:1;min-width:0';
    play.setAttribute('aria-label', '재생: ' + item.title);
    play.innerHTML = '<span class="soundboard-play" aria-hidden="true">▶</span><span class="soundboard-item-copy"><span class="soundboard-item-title">' + escapeHtml(item.title) + '</span><span class="soundboard-item-source">MyInstants · 재생</span></span>';
    play.addEventListener('click', () => {
      playSound(item);
      window.dispatchEvent(new CustomEvent('roomchat:soundboard-send', { detail: { title: item.title, mp3: item.mp3, url: item.url } }));
    });
    const favorite = document.createElement('button');
    favorite.type = 'button'; favorite.className = 'soundboard-favorite' + (favorites.some((fav) => fav.id === item.id) ? ' is-favorite' : '');
    favorite.textContent = favorites.some((fav) => fav.id === item.id) ? '★' : '☆';
    favorite.setAttribute('aria-label', favorites.some((fav) => fav.id === item.id) ? '즐겨찾기 해제' : '즐겨찾기 추가');
    favorite.addEventListener('click', () => toggleFavorite(item));
    card.append(play, favorite);
    resultsEl.append(card);
  });
}
async function loadTab(tab = currentTab) {
  currentTab = tab;
  tabButtons.forEach((button) => {
    const active = button.dataset.soundTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const thisRequest = ++requestId;
  resultsEl.replaceChildren();
  setStatus('사운드를 불러오는 중…');
  try {
    let items;
    if (tab === 'favorites') {
      items = getFavorites();
    } else if (tab === 'recent') {
      items = await fetchSounds('/recent');
    } else {
      items = await fetchSounds('/trending', { q: 'us' });
      if (!items.length) items = await fetchSounds('/best', { q: 'us' });
    }
    if (thisRequest !== requestId) return;
    renderItems(items.slice(0, 40));
    setStatus(items.length ? items.length + '개의 사운드' : '표시할 사운드가 없어요.');
  } catch (error) {
    if (thisRequest !== requestId) return;
    resultsEl.replaceChildren();
    setStatus('사운드 API 오류: ' + (error?.message || '알 수 없는 오류') + ' · 직접 검색 링크도 사용할 수 있어요.');
    const link = document.createElement('a');
    link.href = 'https://www.myinstants.com/en/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'MyInstants 열기 ↗';
    link.className = 'soundboard-fallback-link';
    resultsEl.append(link);
    console.warn('RoomChat soundboard:', error);
  }
}
async function searchSounds(query) {
  const trimmed = query.trim();
  if (!trimmed) { await loadTab('popular'); return; }
  currentTab = 'search';
  tabButtons.forEach((button) => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false'); });
  const thisRequest = ++requestId;
  resultsEl.replaceChildren();
  setStatus('“' + trimmed + '” 검색 중…');
  try {
    const items = await fetchSounds('/search', { q: trimmed });
    if (thisRequest !== requestId) return;
    renderItems(items.slice(0, 40));
    setStatus(items.length ? '검색 결과 ' + items.length + '개' : '검색 결과가 없어요.');
  } catch (error) {
    if (thisRequest !== requestId) return;
    resultsEl.replaceChildren();
    setStatus('검색 API 오류: ' + (error?.message || '알 수 없는 오류') + ' · MyInstants 직접 검색을 이용해 주세요.');
    const link = document.createElement('a');
    link.href = 'https://www.myinstants.com/en/search/?name=' + encodeURIComponent(trimmed);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '“' + trimmed + '” MyInstants에서 검색 ↗';
    link.className = 'soundboard-fallback-link';
    resultsEl.append(link);
    console.warn('RoomChat soundboard search:', error);
  }
}
function playSound(item, remote = false) {
  if (!item?.mp3) return;
  if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
  const audio = new Audio(item.mp3);
  audio.preload = 'none';
  audio.volume = Math.max(0, Math.min(1, Number(volumeInput.value) / 100));
  currentAudio = audio;
  const playPromise = audio.play();
  if (playPromise?.catch) playPromise.catch(() => setStatus('재생할 수 없어요. 브라우저의 오디오 재생 설정을 확인해 주세요.'));
  setStatus((remote ? '방에서 재생 중: ' : '재생 중: ') + item.title);
  audio.addEventListener('ended', () => { if (currentAudio === audio) { currentAudio = null; setStatus('재생이 끝났어요.'); } }, { once: true });
  audio.addEventListener('error', () => { if (currentAudio === audio) { currentAudio = null; setStatus('이 사운드는 재생할 수 없어요. 다른 사운드를 선택해 주세요.'); } }, { once: true });
}
function stopSound() {
  if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio = null; }
  setStatus('재생을 중지했어요.');
}
function toggleFavorite(item) {
  const favorites = getFavorites();
  const exists = favorites.some((fav) => fav.id === item.id);
  const updated = exists ? favorites.filter((fav) => fav.id !== item.id) : [{...item}, ...favorites].slice(0, 100);
  setFavorites(updated);
  if (currentTab === 'favorites') renderItems(updated);
  else renderItems(currentItems);
}
openButton?.addEventListener('click', () => {
  if (!dialog.open) dialog.showModal();
  if (!currentItems.length) loadTab('popular');
});
closeButton?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
dialog?.addEventListener('close', stopSound);
searchForm?.addEventListener('submit', (event) => { event.preventDefault(); searchSounds(queryInput.value); });
tabButtons.forEach((button) => button.addEventListener('click', () => loadTab(button.dataset.soundTab)));
stopButton?.addEventListener('click', stopSound);
volumeInput?.addEventListener('input', () => { if (currentAudio) currentAudio.volume = Number(volumeInput.value) / 100; });

window.addEventListener('roomchat:soundboard-play', (event) => {
  const item = event.detail;
  if (!item || typeof item.title !== 'string' || typeof item.mp3 !== 'string') return;
  if (!isAllowedSoundUrl(item.mp3)) return;
  playSound(item, true);
});
window.addEventListener('roomchat:soundboard-stop', () => stopSound());
