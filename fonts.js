// Google Fonts families. 두 번째 값이 true면 굵기(400/700)를 지원해 둘 다 불러오고,
// 아니면 기본 굵기 하나만 불러와요(굵게는 브라우저가 가짜 굵기로 처리).
const RAW = [
  // 한국어
  ['Noto Sans KR', 1], ['Noto Serif KR', 1], ['Nanum Gothic', 1], ['Nanum Myeongjo', 1], ['Nanum Pen Script'],
  ['Nanum Brush Script'], ['Nanum Gothic Coding', 1], ['Black Han Sans'], ['Do Hyeon'], ['Jua'],
  ['Gamja Flower'], ['Gaegu', 1], ['Hi Melody'], ['Single Day'], ['Stylish'],
  ['Sunflower'], ['Yeon Sung'], ['East Sea Dokdo'], ['Poor Story'], ['Cute Font'],
  ['Dokdo'], ['Gugi'], ['Kirang Haerang'], ['Song Myung'], ['Black And White Picture'],
  ['Bagel Fat One'], ['Dongle', 1], ['Gowun Dodum'], ['Gowun Batang', 1], ['IBM Plex Sans KR', 1],
  ['Hahmlet', 1], ['Gasoek One'], ['Orbit'], ['Moirai One'], ['Diphylleia'],
  // 산세리프
  ['Roboto', 1], ['Open Sans', 1], ['Lato', 1], ['Montserrat', 1], ['Poppins', 1],
  ['Inter', 1], ['Nunito', 1], ['Raleway', 1], ['Ubuntu', 1], ['Rubik', 1],
  ['Work Sans', 1], ['DM Sans', 1], ['Quicksand', 1], ['Josefin Sans', 1], ['Cabin', 1],
  ['Space Grotesk', 1], ['Fredoka', 1], ['Baloo 2', 1], ['Comfortaa', 1], ['Oswald', 1],
  ['Bebas Neue'], ['Anton'], ['Righteous'], ['Chewy'], ['Bangers'],
  // 세리프
  ['Playfair Display', 1], ['Merriweather', 1], ['Lora', 1], ['PT Serif', 1], ['EB Garamond', 1],
  ['Cormorant Garamond', 1], ['Crimson Text', 1], ['Libre Baskerville', 1], ['Bitter', 1], ['Zilla Slab', 1],
  ['Abril Fatface'], ['Alfa Slab One'], ['Cinzel', 1],
  // 손글씨·필기체
  ['Pacifico'], ['Lobster'], ['Caveat', 1], ['Dancing Script', 1], ['Indie Flower'],
  ['Shadows Into Light'], ['Permanent Marker'], ['Satisfy'], ['Great Vibes'], ['Sacramento'],
  ['Courgette'], ['Kaushan Script'], ['Amatic SC', 1], ['Gloria Hallelujah'], ['Patrick Hand'],
  ['Architects Daughter'], ['Rock Salt'], ['Homemade Apple'], ['Cookie'], ['Yellowtail'],
  ['Kalam', 1], ['Handlee'], ['Marck Script'],
  // 디스플레이·고정폭
  ['Press Start 2P'], ['VT323'], ['Orbitron', 1], ['Audiowide'], ['Bungee'],
  ['Special Elite'], ['Creepster'], ['Luckiest Guy'], ['Fugaz One'], ['Source Code Pro', 1],
  ['Fira Code', 1], ['JetBrains Mono', 1], ['IBM Plex Mono', 1], ['Inconsolata', 1], ['Silkscreen', 1],
  ['Monoton'], ['Pirata One'], ['Lilita One'], ['Titan One'],
];

export const FONTS = RAW.map(([name, weights]) => ({ name, weights: Boolean(weights) }));
const BY_NAME = new Map(FONTS.map((font) => [font.name, font]));
const loaded = new Set();

export function fontByName(name) {
  return BY_NAME.get(name) || null;
}

export function fontStack(name) {
  return fontByName(name) ? `"${name}", "Noto Sans KR", sans-serif` : '';
}

// 사용하는 글꼴만 그때그때 불러와서, 100개를 한꺼번에 내려받지 않아요.
export function ensureFont(name) {
  const font = fontByName(name);
  if (!font) return false;
  if (loaded.has(name)) return true;
  loaded.add(name);
  const family = encodeURIComponent(name).replace(/%20/g, '+');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}${font.weights ? ':wght@400;700' : ''}&display=swap`;
  document.head.append(link);
  return true;
}
